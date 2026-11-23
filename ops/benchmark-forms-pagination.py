#!/usr/bin/env python3
"""Compare offset/keyset HTTP exports using disposable PostgreSQL and PostgREST containers."""
import argparse
import base64
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import secrets
import statistics
import subprocess
import tempfile
import time
from urllib.parse import urlencode


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
    parser.add_argument('--postgres-image', default='postgres:17')
    parser.add_argument('--postgrest-image', default='postgrest/postgrest:v14.12')
    args = parser.parse_args()
    if not 1000 <= args.rows <= 1000000 or not 1 <= args.rounds <= 5:
        parser.error('Expected 1000–1000000 rows and 1–5 rounds')
    suffix = secrets.token_hex(5)
    database = 'forms_keyset_bench'
    network = f'forms-keyset-bench-{suffix}'
    postgres = f'{network}-db'
    postgrest = f'{network}-api'
    cleanup = []
    env_path = None
    connection = None
    report = {'rows': args.rows, 'rounds': args.rounds, 'database': database,
              'transport': 'HTTP loopback, actual PostgREST, authenticated admin with forms RLS',
              'full_exports': [], 'samples': [], 'plans': {}, 'checks': {}}

    def sql(statement):
        return command(['docker', 'exec', '-i', postgres, 'psql', '-X', '-qAt',
                        '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], statement)

    try:
        command(['docker', 'network', 'create', network])
        cleanup.append(['docker', 'network', 'rm', network])
        with tempfile.NamedTemporaryFile('w', prefix='forms-bench-db-env-') as db_env:
            db_env.write(f'POSTGRES_DB={database}\nPOSTGRES_PASSWORD={secrets.token_hex(32)}\n')
            db_env.flush()
            cleanup.append(['docker', 'rm', '-fv', postgres])
            command(['docker', 'run', '--detach', '--name', postgres, '--network', network,
                     '--network-alias', 'db', '--memory=1g', '--cpus=2', '--env-file', db_env.name,
                     args.postgres_image])
        for attempt in range(60):
            try:
                command(['docker', 'exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database])
                break
            except RuntimeError:
                if attempt == 59:
                    raise RuntimeError('Disposable PostgreSQL did not start') from None
                time.sleep(0.5)
        authenticator_password = secrets.token_hex(32)
        bench_uri = f'postgresql://authenticator:{authenticator_password}@db:5432/{database}'
        sql(f"""
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password '{authenticator_password}';
grant anon, authenticated to authenticator;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{{}}', banned_until timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, user_metadata jsonb, created_at timestamptz default now(),
  updated_at timestamptz default now(), version text);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create publication supabase_realtime;
""")
        sql((args.root / 'database/supabase_schema.sql').read_text())
        sql(f"""
set statement_timeout = '120s';
insert into auth.users (id, email, raw_user_meta_data)
select ('10000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'fixture-' || n || '@example.invalid', jsonb_build_object('name', 'Synthetic author ' || n)
from generate_series(1, 100) n;
update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000001';
update public.profiles set is_disabled = true where id = '10000000-0000-4000-8000-000000000100';
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
analyze public.forms;
analyze public.profiles;
""")
        report['postgres_version'] = sql('select version();')
        report['postgrest_image'] = args.postgrest_image
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
        cleanup.append(['docker', 'rm', '-fv', postgrest])
        command(['docker', 'run', '-d', '--name', postgrest, '--network', network,
                 '--memory=256m', '--cpus=1', '-p', '127.0.0.1::3000', '--env-file', env_path, args.postgrest_image])
        os.unlink(env_path)
        env_path = None
        port = int(command(['docker', 'port', postgrest, '3000']).split(':')[-1])
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
            last_full_page = max(0, expected_count - size - 1)
            for offset in sorted({0, expected_count // 10, expected_count // 2, last_full_page}):
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
                if last_full_page and offset == last_full_page:
                    for mode in series:
                        report['plans'][f'{mode}_{size}'] = request(mode, size, offset, cursor, plan=True)[0]
        def plan_nodes(node):
            yield node
            for child in node.get('Plans', []):
                yield from plan_nodes(child)
        for name, plans in report['plans'].items():
            page_size = int(name.rsplit('_', 1)[1])
            # A full scan can be cheaper on small data sets if a wide page
            # selects much of the table. Check the index at selective boundaries.
            if name.startswith('keyset') and (page_size + 1) * 10 <= expected_count:
                assert any('ROW(created_at, id) < ROW(' in node.get('Index Cond', '')
                           for node in plan_nodes(plans[0]['Plan'])), (name, 'HTTP plan does not seek by cursor')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print('HTTP plans verified: selective keyset pages seek by the cursor index.', flush=True)
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
        cleanup_errors = []
        for action in reversed(cleanup):
            result = subprocess.run(action, capture_output=True, text=True)
            if result.returncode and not any(message in result.stderr for message in ('No such container', 'not found')):
                cleanup_errors.append(action[-1])
        report['cleaned_up'] = not cleanup_errors
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        if cleanup_errors:
            raise RuntimeError('Could not clean up disposable resources: ' + ', '.join(cleanup_errors))
    print(f'Complete. Disposable database, API and network removed. Report: {args.output}', flush=True)


if __name__ == '__main__':
    main()
