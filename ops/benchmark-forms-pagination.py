#!/usr/bin/env python3
"""Compare actual offset/keyset HTTP exports in a disposable Supabase database.
Run on the Docker backend host; uses only Python's standard library. The production
DB is only inspected to locate PostgREST. Test rows never enter production tables.
"""
import argparse
import base64
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import statistics
import subprocess
import tempfile
import time
from urllib.parse import urlencode, urlsplit, urlunsplit


def command(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True)
    if result.returncode:
        # Never include Docker environment/connection strings in an exception.
        raise RuntimeError(f"{args[0]} failed: {result.stderr[-2000:]}")
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--rows', type=int, default=100000)
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert 1000 <= args.rows <= 1000000
    assert 1 <= args.rounds <= 5
    suffix = secrets.token_hex(5)
    database = f'forms_keyset_bench_{suffix}'
    container = f'forms-keyset-bench-{suffix}'
    created = started = False
    env_path = None
    connection = None
    report = {'rows': args.rows, 'rounds': args.rounds, 'database': database,
              'transport': 'HTTP loopback, actual PostgREST, authenticated admin with forms RLS',
              'full_exports': [], 'samples': [], 'plans': {}, 'checks': {}}

    def sql(statement):
        return command(['docker', 'exec', '-i', 'supabase-db', 'psql', '-X', '-qAt',
                        '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], statement)

    try:
        config = json.loads(command(['docker', 'inspect', 'supabase-rest']))[0]
        env = dict(item.split('=', 1) for item in config['Config']['Env'] if '=' in item)
        uri = urlsplit(env['PGRST_DB_URI'])
        bench_uri = urlunsplit((uri.scheme, uri.netloc, '/' + database, uri.query, uri.fragment))
        network = next(iter(config['NetworkSettings']['Networks']))
        command(['docker', 'exec', 'supabase-db', 'createdb', '-U', 'postgres', database])
        created = True
        baseline = (args.root / 'database/supabase_schema.sql').read_text()
        forms_table = re.search(r'create table public\.forms \([\s\S]*?\n\);', baseline)[0]
        helpers = '\n'.join(re.search(r'create or replace function public\.' + name + r'\([\s\S]*?\$\$;', baseline)[0]
                            for name in ['request_role', 'request_is_enabled', 'is_public_active_form'])
        policies = '\n'.join(re.search(r'create policy "' + name + r'"[\s\S]*?\n\);', baseline)[0]
                             for name in ['forms_select', 'forms_select_anon'])
        indexes = '\n'.join(re.findall(r'create index idx_forms_\w+[\s\S]*?;', baseline))
        sql(f"""
set statement_timeout = '120s';
create schema auth;
create schema extensions;
create extension pg_trgm with schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
create table public.profiles (id uuid primary key, role text not null, is_disabled boolean not null);
insert into public.profiles select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case when n = 1 then 'admin' else 'user' end, n = 100 from generate_series(1, 100) n;
{forms_table}
insert into public.forms (id, title, form_type, form_reason, schema, theme, is_public,
  author_id, author_name, created_at, responses_count)
select ('20000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'Synthetic form ' || n,
  case when n % 10 = 0 then 'template' else 'anketa' end,
  case when n % 3 = 0 then 'order' else 'plan' end,
  jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('description', repeat(md5(n::text), 32)))),
  '{{}}'::jsonb, n % 4 <> 0,
  ('10000000-0000-4000-8000-' || lpad((n % 99 + 1)::text, 12, '0'))::uuid,
  'Synthetic author ' || (n % 99 + 1),
  '2026-01-01T00:00:00.123456Z'::timestamptz + (n / 50) * interval '1 microsecond', n % 100
from generate_series(1, {args.rows}) n;
{indexes}
{helpers}
alter table public.forms enable row level security;
{policies}
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant select on public.forms to anon, authenticated, service_role;
analyze public.forms;
analyze public.profiles;
""")
        sql((args.root / 'database/migrations/202609081200_forms_keyset_pagination.sql').read_text())
        report['postgres_version'] = sql('select version();')
        report['postgrest_image'] = config['Config']['Image']
        report['table_bytes'] = int(sql("select pg_total_relation_size('public.forms');"))
        jwt_secret = secrets.token_urlsafe(48)
        def token(user):
            def b64(value):
                return base64.urlsafe_b64encode(value).rstrip(b'=').decode()
            body = '.'.join(b64(json.dumps(value).encode()) for value in [
                {'alg': 'HS256', 'typ': 'JWT'},
                {'role': 'authenticated', 'sub': f'10000000-0000-4000-8000-{user:012d}', 'exp': int(time.time()) + 3600}])
            return body + '.' + b64(hmac.new(jwt_secret.encode(), body.encode(), hashlib.sha256).digest())
        with tempfile.NamedTemporaryFile('w', prefix='forms-bench-env-', delete=False) as env_file:
            env_path = env_file.name
            os.chmod(env_path, 0o600)
            env_file.write(f'PGRST_DB_URI={bench_uri}\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\n'
                           f'PGRST_JWT_SECRET={jwt_secret}\nPGRST_DB_MAX_ROWS=1000\nPGRST_DB_PLAN_ENABLED=true\n'
                           'PGRST_DB_POOL=2\nPGRST_DB_CHANNEL_ENABLED=false\n')
        command(['docker', 'run', '-d', '--name', container, '--network', network,
                 '--memory=256m', '--cpus=1', '-p', '127.0.0.1::3000', '--env-file', env_path, config['Config']['Image']])
        started = True
        os.unlink(env_path)
        env_path = None
        port = int(command(['docker', 'port', container, '3000']).split(':')[-1])
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=30)
        select = 'id,title,form_type,form_reason,is_public,deadline_at,max_responses,author_id,author_name,created_at,responses_count'
        def request(mode, size, offset=0, cursor=None, filters=None, user=1, plan=False, include_lookahead=True):
            params = {'select': select, 'order': 'created_at.desc,id.desc', 'limit': size + int(include_lookahead),
                      **({'form_type': 'neq.template'} if filters is None else filters)}
            headers = {'Content-Type': 'application/json'}
            if user is not None:
                headers['Authorization'] = 'Bearer ' + token(user)
            if plan:
                headers['Accept'] = 'application/vnd.pgrst.plan+json; options=analyze|buffers'
            if mode == 'offset':
                params['offset'] = offset
                path, method, body = '/forms', 'GET', None
            else:
                path, method, body = '/rpc/list_forms_keyset', 'GET', None
                if cursor:
                    params.update(p_before_created_at=cursor['created_at'], p_before_id=cursor['id'])
            begin = time.perf_counter()
            connection.request(method, path + '?' + urlencode(params), body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read()
            elapsed = (time.perf_counter() - begin) * 1000
            payload = json.loads(raw)
            if response.status not in (200, 206):
                if user is None and mode == 'keyset' and response.status in (401, 403):
                    return payload, elapsed, len(raw)
                raise RuntimeError(f'HTTP {response.status}: {payload}')
            return payload, elapsed, len(raw)
        for attempt in range(30):
            try:
                request('offset', 1)
                break
            except (OSError, RuntimeError):
                if attempt == 29:
                    raise
                time.sleep(0.5)
        expected_ids = json.loads(sql("select json_agg(id order by created_at desc, id desc) from public.forms where form_type <> 'template';"))
        expected_hash = hashlib.sha256(''.join(item + '\n' for item in expected_ids).encode()).hexdigest()
        expected_count = len(expected_ids)
        report['dashboard_rows'] = expected_count
        print(f'Ready: {args.rows} synthetic forms, {expected_count} dashboard rows, RLS enabled.', flush=True)
        # Deep-page plans and warmed HTTP samples. Fetching the boundary is setup,
        # equivalent to a key the application retained from its preceding page.
        for size in [20, 999]:
            for offset in [0, expected_count // 10, expected_count // 2, expected_count - size - 1]:
                cursor = request('offset', 1, offset - 1)[0][0] if offset else None
                series = {'offset': [], 'keyset': []}
                for repeat in range(12):
                    for mode in (['offset', 'keyset'] if repeat % 2 == 0 else ['keyset', 'offset']):
                        rows, elapsed, _ = request(mode, size, offset, cursor)
                        assert [row['id'] for row in rows] == expected_ids[offset:offset + size + 1]
                        if repeat >= 2:
                            series[mode].append(elapsed)
                for mode in series:
                    report['samples'].append({'mode': mode, 'page_size': size, 'offset_equivalent': offset,
                                              'median_ms': statistics.median(series[mode]), 'runs_ms': series[mode]})
                if offset == expected_count - size - 1:
                    for mode in series:
                        report['plans'][f'{mode}_{size}'] = request(mode, size, offset, cursor, plan=True)[0]
        def plan_nodes(node):
            yield node
            for child in node.get('Plans', []):
                yield from plan_nodes(child)
        for name, plans in report['plans'].items():
            if name.startswith('keyset'):
                assert any('ROW(created_at, id) < ROW(' in node.get('Index Cond', '')
                           for node in plan_nodes(plans[0]['Plan'])), (name, 'HTTP plan does not seek by cursor')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print('HTTP plans verified: keyset row comparison is an Index Cond.', flush=True)
        # Same function/filter path with templates, own forms, title/author search,
        # dates and a non-admin/disabled identity, not just an unrestricted scan.
        for name, filters, user in [
            ('templates', {'form_type': 'eq.template', 'is_public': 'eq.true'}, 1),
            ('mine', {'form_type': 'neq.template', 'author_id': 'eq.10000000-0000-4000-8000-000000000002'}, 2),
            ('non_admin', {'form_type': 'neq.template'}, 2),
            ('disabled', {'form_type': 'neq.template'}, 100),
            ('search_date_reason', {'form_type': 'neq.template', 'or': '(title.ilike.%123%,author_name.ilike.%author 2%)',
                                   'created_at': 'gte.2026-01-01T00:00:00.123456Z', 'form_reason': 'eq.order'}, 1),
        ]:
            first = request('keyset', 20, filters=filters, user=user)[0]
            assert first == request('offset', 20, filters=filters, user=user)[0]
            if len(first) > 20:
                assert request('keyset', 20, cursor=first[19], filters=filters, user=user)[0] == request('offset', 20, 20, filters=filters, user=user)[0]
            if name == 'disabled':
                assert first == []
            report['checks'][name] = True
        report['checks']['anon_rpc_denied'] = request('keyset', 20, user=None)[0].get('code') == '42501'
        print('Filter and RLS checks passed.', flush=True)
        for round_index in range(args.rounds):
            for size in [20, 999]:
                for mode in (['offset', 'keyset'] if round_index % 2 == 0 else ['keyset', 'offset']):
                    digest = hashlib.sha256()
                    total = pages = byte_count = 0
                    cursor = None
                    times = []
                    begin = time.perf_counter()
                    while True:
                        rows, elapsed, transferred = request(mode, size, total, cursor)
                        times.append(elapsed)
                        pages += 1
                        byte_count += transferred
                        items = rows[:size]
                        for row in items:
                            assert row['id'] == expected_ids[total], (mode, total, row['id'])
                            digest.update((row['id'] + '\n').encode())
                            total += 1
                        if len(rows) <= size:
                            break
                        cursor = items[-1]
                    wall = (time.perf_counter() - begin) * 1000
                    assert total == expected_count and digest.hexdigest() == expected_hash
                    result = {'round': round_index + 1, 'mode': mode, 'page_size': size, 'rows': total,
                              'requests': pages, 'wall_ms': wall, 'http_ms': sum(times),
                              'page_p50_ms': statistics.median(times), 'page_p95_ms': sorted(times)[int(len(times) * .95)],
                              'bytes_received': byte_count, 'sha256_ids': digest.hexdigest()}
                    report['full_exports'].append(result)
                    args.output.write_text(json.dumps(report, indent=2) + '\n')
                    print(json.dumps(result), flush=True)
        first = request('keyset', 20)[0]
        boundary = first[19]
        sql(f"delete from public.forms where id in ('{first[0]['id']}', '{boundary['id']}');")
        sql("""insert into public.forms (id, title, form_type, form_reason, schema, author_id, created_at)
             values ('30000000-0000-4000-8000-000000000001', 'Inserted during pagination', 'anketa', 'plan', '{}',
                     '10000000-0000-4000-8000-000000000001', '2027-01-01');""")
        continued = request('keyset', 20, cursor=boundary)[0]
        assert [row['id'] for row in continued[:20]] == expected_ids[20:40]
        report['checks']['cursor_survives_insert_and_boundary_delete'] = True
        report['checks']['identical_full_exports_with_microsecond_ties'] = True
        assert all(report['checks'].values())
    finally:
        if connection:
            connection.close()
        if env_path:
            os.unlink(env_path)
        if started:
            command(['docker', 'rm', '-f', container])
        if created:
            command(['docker', 'exec', 'supabase-db', 'dropdb', '-U', 'postgres', database])
        report['cleaned_up'] = True
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Complete. Test container and database removed. Report: {args.output}', flush=True)


if __name__ == '__main__':
    main()
