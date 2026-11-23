#!/usr/bin/env python3
"""Online PostgreSQL snapshot + versioned Storage backup; never stop production."""
import argparse, datetime, fcntl, gzip, hashlib, json, os, pathlib, re, shutil, signal, subprocess, tarfile, tempfile, time
from contextlib import contextmanager
from zoneinfo import ZoneInfo
BASE = pathlib.Path('/mnt/data/forms_backup')
ROOT = pathlib.Path('/opt/survey-app')
DB = 'supabase-db'
USER = 'supabase_admin'
RETENTION_COUNT = 5
PARTIAL_RETENTION_COUNT = 2
BACKUP_TIMEZONE = ZoneInfo('Europe/Moscow')
STAMP_FORMAT = '%Y%m%dT%H%M%SZ'
LEGACY_NAME = re.compile(r'(?:(deploy(?:-[a-z0-9-]+)?)-)?(\d{8}T\d{6}Z)')
DATED_NAME = re.compile(r'(\d{2}-\d{2}-\d{2})-(full|deploy(?:-[a-z0-9-]+)?)')

@contextmanager
def backup_lock(shared=False, wait_seconds=0):
    if not os.path.ismount('/mnt/data'): raise RuntimeError('/mnt/data must be mounted; refusing to use the system disk')
    if BASE.resolve() != BASE.absolute(): raise RuntimeError('Backup directory must not be a symlink')
    BASE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(BASE, 0o700)
    mode = fcntl.LOCK_SH if shared else fcntl.LOCK_EX
    deadline = time.monotonic() + max(0.0, float(wait_seconds))
    with (BASE / '.lock').open('a') as lock:
        while True:
            try:
                fcntl.flock(lock, mode | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise
                time.sleep(min(0.5, remaining))
        yield

def write_backup_readme():
    text = pathlib.Path(__file__).with_name('BACKUP_FILES.md').read_text()
    temporary = BASE / '.README.md.tmp'
    temporary.write_text(text)
    os.chmod(temporary, 0o600)
    temporary.replace(BASE / 'README.md')

def backup_location(created_at, label='full'):
    local = created_at.astimezone(BACKUP_TIMEZONE)
    return BASE / local.strftime('%Y-%m-%d') / (local.strftime('%H-%M-%S') + '-' + label)

def backup_catalog(kind):
    entries = []
    for parent in BASE.iterdir():
        if not parent.is_dir() or parent.is_symlink(): continue
        legacy = LEGACY_NAME.fullmatch(parent.name)
        if legacy:
            created = datetime.datetime.strptime(legacy[2], STAMP_FORMAT).replace(tzinfo=datetime.timezone.utc)
            candidates = [(parent, created, legacy[1] or 'full')]
        elif re.fullmatch(r'\d{4}-\d{2}-\d{2}', parent.name):
            candidates = []
            for path in parent.iterdir():
                match = DATED_NAME.fullmatch(path.name)
                if not match or not path.is_dir() or path.is_symlink(): continue
                created = datetime.datetime.strptime(parent.name + ' ' + match[1], '%Y-%m-%d %H-%M-%S').replace(tzinfo=BACKUP_TIMEZONE)
                candidates.append((path, created, match[2]))
        else: continue
        for path, created, label in candidates:
            actual_kind = 'full' if label == 'full' else 'deploy'
            if actual_kind != kind: continue
            if kind == 'full':
                manifest_file = path / 'manifest.json'
                if not manifest_file.is_file() or manifest_file.is_symlink(): continue
                manifest = json.loads(manifest_file.read_text())
                created = datetime.datetime.strptime(manifest['createdAt'], STAMP_FORMAT).replace(tzinfo=datetime.timezone.utc)
            elif not any(path.glob('*.tar.gz')): continue
            entries.append((created, path, label))
    return sorted(entries, key=lambda entry: (entry[0], str(entry[1])))

def validate_deployment(path):
    if path.resolve() != path.absolute(): raise RuntimeError('Invalid deployment directory: ' + str(path))
    archives = sorted(path.glob('*.tar.gz'))
    if not archives: raise RuntimeError('No deployment archives: ' + str(path))
    for archive in archives:
        if archive.is_symlink(): raise RuntimeError('Deployment archive must not be a symlink')
        # Read every file to check gzip integrity, without extracting archive paths.
        with gzip.open(archive, 'rb') as compressed:
            with tarfile.open(fileobj=compressed, mode='r|') as tar:
                for member in tar:
                    if member.isfile():
                        with tar.extractfile(member) as stream:
                            while stream.read(1024 * 1024): pass
            # A tar reader may stop at its end marker before reading the gzip trailer.
            while compressed.read(1024 * 1024): pass
    digests = {}
    metadata = path / 'deployment.json'
    if metadata.is_symlink() or (metadata.exists() and not metadata.is_file()):
        raise RuntimeError('Invalid deployment metadata: ' + str(path))
    if metadata.is_file():
        expected = json.loads(metadata.read_text()).get('frontendBackupSha256')
        if expected:
            target = path / 'magi-before.tar.gz'
            if target not in archives or not target.is_file():
                raise RuntimeError('Missing frontend backup: ' + str(path))
            digests[target] = digest(target)
            if digests[target] != expected:
                raise RuntimeError('Deployment checksum mismatch: ' + str(path))
    checksums = path / 'SHA256SUMS'
    if checksums.is_symlink() or (checksums.exists() and not checksums.is_file()):
        raise RuntimeError('SHA256SUMS must be a regular file')
    if checksums.is_file():
        for raw_line in checksums.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#'): continue
            parts = line.split(maxsplit=1)
            if len(parts) != 2: raise RuntimeError('Malformed SHA256SUMS line')
            expected, name = parts
            name = name.lstrip('*')
            target = path / name
            if not name or pathlib.Path(name).name != name or target.is_symlink() or not target.is_file():
                raise RuntimeError('Invalid deployment checksum path: ' + name)
            if target not in digests:
                digests[target] = digest(target)
            if digests[target] != expected:
                raise RuntimeError('Deployment checksum mismatch: ' + name)

def prune_partials(keep=PARTIAL_RETENTION_COUNT):
    partials = []
    for parent in BASE.iterdir():
        if not parent.is_dir() or parent.is_symlink() or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', parent.name):
            continue
        for entry in parent.iterdir():
            if re.fullmatch(r'\.partial-\d{2}-\d{2}-\d{2}-full', entry.name) and entry.is_dir() and not entry.is_symlink():
                partials.append((entry.stat().st_mtime, entry))
    partials.sort(key=lambda item: (item[0], str(item[1])))
    for _, stale in partials[:-keep] if keep > 0 else partials:
        shutil.rmtree(stale)
        print(json.dumps({'removed': str(stale), 'kind': 'partial'}))
        if stale.parent != BASE and not any(stale.parent.iterdir()): stale.parent.rmdir()

def prune_backups(kind, *, validated=False):
    entries = backup_catalog(kind)
    if len(entries) <= RETENTION_COUNT: return
    # Deployment archives come from the publisher, not the pg_dump workflow.
    # Verify the retained archive set before removing any older publication.
    if kind == 'deploy' and not validated:
        for _, path, _ in entries[-RETENTION_COUNT:]: validate_deployment(path)
    for _, path, _ in entries[:-RETENTION_COUNT]:
        shutil.rmtree(path)
        print(json.dumps({'removed': str(path), 'kind': kind}))
        if path.parent != BASE and not any(path.parent.iterdir()): path.parent.rmdir()

def organize_backups():
    entries = backup_catalog('full') + backup_catalog('deploy')
    moves = []
    for created, path, label in entries:
        target = backup_location(created, label)
        if path != target:
            if target.exists() or any(target == planned[1] for planned in moves):
                raise RuntimeError('Backup destination already exists: ' + str(target))
            moves.append((path, target))
    # Complete verification precedes renames and pruning; a failed check keeps all copies.
    for _, path, label in entries:
        if label == 'full': validate(path)
        else: validate_deployment(path)
    for path, target in moves:
        if target.parent.resolve() != target.parent.absolute(): raise RuntimeError('Invalid backup destination: ' + str(target))
    for path, target in moves:
        target.parent.mkdir(mode=0o700, exist_ok=True)
        path.rename(target)
        print(json.dumps({'movedFrom': str(path), 'movedTo': str(target)}))
    write_backup_readme()
    prune_backups('full')
    prune_backups('deploy', validated=True)

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)
def db(args, **kwargs):
    return run(['docker', 'exec', DB, *args], **kwargs)
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()
def validate(path, verify_digests=True):
    root_resolved = path.resolve()
    if root_resolved != path.absolute(): raise RuntimeError('Invalid backup directory: ' + str(path))
    manifest_file = path / 'manifest.json'
    if manifest_file.is_symlink() or not manifest_file.is_file():
        raise RuntimeError('Missing backup manifest: ' + str(path))
    manifest = json.loads(manifest_file.read_text())
    for name, expected in manifest['sha256'].items():
        if name.startswith('/') or '..' in pathlib.PurePosixPath(name).parts:
            raise RuntimeError('Invalid manifest path: ' + name)
        file = path / name
        if file.resolve() != file.absolute() or not file.is_file():
            raise RuntimeError('Invalid backup file: ' + name)
        if verify_digests and digest(file) != expected:
            raise RuntimeError('Backup checksum mismatch: ' + name)
    for obj in manifest['objects']:
        parts = (obj['bucket_id'], obj['name'], obj['version'])
        if any('..' in pathlib.PurePosixPath(v).parts or v.startswith('/') for v in parts):
            raise RuntimeError('Invalid storage object path')
        file = path / 'storage/stub/stub' / parts[0] / parts[1] / parts[2]
        if file.resolve() != file.absolute() or not file.is_file() or (obj['size'] is not None and file.stat().st_size != obj['size']):
            raise RuntimeError('Storage snapshot is incomplete')
    print(json.dumps({'backup': path.name, 'verifiedFiles': len(manifest['sha256']), 'storageObjects': len(manifest['objects'])}))
    return manifest

def backup(lock_timeout=0):
    with backup_lock(wait_seconds=lock_timeout):
        write_backup_readme()
        # Reserve room for this attempt even when the last few runs failed.
        prune_partials(keep=PARTIAL_RETENTION_COUNT - 1)
        created = datetime.datetime.now(datetime.timezone.utc)
        stamp = created.strftime(STAMP_FORMAT)
        final = backup_location(created)
        if final.parent.resolve() != final.parent.absolute(): raise RuntimeError('Invalid backup destination: ' + str(final))
        final.parent.mkdir(mode=0o700, exist_ok=True)
        if final.exists(): raise RuntimeError('Backup destination already exists: ' + str(final))
        work = final.with_name('.partial-' + final.name)
        work.mkdir(mode=0o700)
        snapshots = [entry[1] for entry in backup_catalog('full')]
        storage = ROOT / 'supabase/docker/volumes/storage'
        target = work / 'storage'
        target.mkdir()
        # Versioned data is immutable. rsync never uses --inplace or --delete:
        # retain files that disappear while pg_dump takes its snapshot.
        copy = ['rsync', '-a', '--safe-links']
        if snapshots: copy += ['--link-dest=' + str(snapshots[-1] / 'storage')]
        copy += [str(storage) + '/', str(target) + '/']
        holder = None
        try:
            run(copy, stdout=subprocess.DEVNULL)
            holder = subprocess.Popen(['docker', 'exec', '-i', DB, 'psql', '-XqAt', '-U', USER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            holder.stdin.write("begin isolation level repeatable read read only;\nset local idle_in_transaction_session_timeout=0;\nselect pg_export_snapshot();\n")
            holder.stdin.flush()
            snapshot = holder.stdout.readline().strip()
            if not snapshot or not all(c in '0123456789ABCDEFabcdef-' for c in snapshot): raise RuntimeError('Cannot acquire database snapshot')
            holder.stdin.write("select row_to_json(o) from (select bucket_id,name,coalesce(version,'') as version,(metadata->>'size')::bigint as size from storage.objects order by bucket_id,name) o;\nselect 'END_OBJECTS';\n")
            holder.stdin.flush()
            objects = []
            for line in holder.stdout:
                if line.strip() == 'END_OBJECTS': break
                objects.append(json.loads(line))
            else: raise RuntimeError('Incomplete database manifest')
            with (work / 'postgres.dump').open('wb') as out:
                db(['pg_dump', '-U', USER, '-d', 'postgres', '-Fc', '--snapshot=' + snapshot], stdout=out)
            holder.stdin.write('rollback;\n\\q\n'); holder.stdin.flush(); holder.wait(timeout=15); holder = None
            with (work / 'globals.sql').open('wb') as out:
                db(['pg_dumpall', '-U', USER, '--globals-only'], stdout=out)
            with (work / 'supabase-internal.dump').open('wb') as out:
                db(['pg_dump', '-U', USER, '-d', '_supabase', '-Fc'], stdout=out)
            run(copy, stdout=subprocess.DEVNULL)
            for obj in objects:
                parts = (obj['bucket_id'], obj['name'], obj['version'])
                if any('..' in pathlib.PurePosixPath(v).parts or v.startswith('/') for v in parts): raise RuntimeError('Invalid storage object path')
                f = target / 'stub/stub' / parts[0] / parts[1] / parts[2]
                if not f.is_file() or (obj['size'] is not None and f.stat().st_size != obj['size']):
                    raise RuntimeError('An object changed during backup; retry instead of accepting an incomplete snapshot')
            compose = ROOT / 'supabase/docker'
            with tarfile.open(work / 'configuration.tar.gz', 'w:gz') as archive:
                sources = [compose/'.env', *compose.glob('docker-compose*.yml'), compose/'volumes/functions', compose/'volumes/api', compose/'volumes/pooler', compose/'mail-worker']
                sources += [ROOT/name for name in ('database','functions','office-service','mail-worker','frontend','ops','nginx.conf','README.md')]
                def include(info):
                    return None if any(x in ('node_modules','.git','coverage','test-results','__pycache__') for x in pathlib.PurePosixPath(info.name).parts) else info
                for source in sources:
                    if source.exists(): archive.add(source, arcname=str(source.relative_to(ROOT)), filter=include)
            run(['docker', 'cp', DB + ':/etc/postgresql-custom', str(work / 'db-config')], stdout=subprocess.DEVNULL)
            preload = subprocess.check_output(['docker','exec',DB,'psql','-U',USER,'-d','postgres','-At','-c','show shared_preload_libraries'],text=True).strip()
            image = db_inspect_image()
            digests = {}
            for file in sorted(work.rglob('*')):
                if file.is_symlink(): raise RuntimeError('Unexpected symlink in backup: ' + str(file.relative_to(work)))
                if file.is_file():
                    digests[str(file.relative_to(work))] = digest(file)
            manifest = {'createdAt': stamp, 'databaseImage': image, 'sharedPreloadLibraries': preload, 'objects': objects,
                        'sha256': digests}
            (work / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
            validate(work, verify_digests=False)
            work.rename(final)
            # Only verified, completed snapshots participate in retention.
            prune_backups('full')
            try:
                prune_backups('deploy')
            except Exception as exc:
                print(json.dumps({'warning': 'deploy prune skipped', 'error': str(exc)}))
            print(json.dumps({'status':'complete','path':str(final)}))
        finally:
            if holder is not None:
                try: holder.communicate('rollback;\n\\q\n', timeout=15)
                except Exception: holder.kill()
            # Failed snapshots remain .partial for diagnosis and never count as backup.

def db_inspect_image():
    return subprocess.check_output(['docker','inspect',DB,'--format','{{.Image}}'],text=True).strip()

def restore_check(path):
    manifest = validate(path)
    name = 'survey-backup-restore-' + str(os.getpid())
    try:
        run(['docker','run','--pull=never','--detach','--name',name,'--network','none','--memory','1g',
             '-e','POSTGRES_PASSWORD=isolated-restore-check',manifest['databaseImage'],'postgres','-c','listen_addresses=', '-c', 'shared_preload_libraries=' + manifest.get('sharedPreloadLibraries','pg_stat_statements,pgaudit,pg_net'), '-c', 'cron.database_name=backup_check'],stdout=subprocess.DEVNULL)
        for _ in range(60):
            r=subprocess.run(['docker','exec',name,'pg_isready','-U',USER],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if r.returncode == 0:
                comm = subprocess.check_output(['docker','exec',name,'cat','/proc/1/comm'],text=True).strip()
                logs = subprocess.check_output(['docker','logs',name],stderr=subprocess.STDOUT,text=True)
                if comm in ('postgres', '.postgres-wrapp') and 'init process complete' in logs: break
            time.sleep(1)
        else: raise RuntimeError('Isolated restore PostgreSQL did not start')
        run(['docker','exec',name,'createdb','-U',USER,'-T','template0','backup_check'])
        with (path/'postgres.dump').open('rb') as data:
            run(['docker','exec','-i',name,'pg_restore','-U',USER,'-d','backup_check','--exit-on-error','--no-owner','--no-privileges'],stdin=data,stdout=subprocess.DEVNULL)
        run(['docker','exec',name,'createdb','-U',USER,'-T','template0','internal_backup_check'])
        with (path/'supabase-internal.dump').open('rb') as data:
            run(['docker','exec','-i',name,'pg_restore','-U',USER,'-d','internal_backup_check','--exit-on-error','--no-owner','--no-privileges'],stdin=data,stdout=subprocess.DEVNULL)
        result=subprocess.check_output(['docker','exec',name,'psql','-U',USER,'-d','backup_check','-At','-c','select count(*) from storage.objects'],text=True).strip()
        if int(result) != len(manifest['objects']): raise RuntimeError('Restored object count differs')
        report = {'verifiedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'storageObjects': int(result), 'databases': ['postgres', '_supabase'],
                  'database': 'isolated container, no published ports'}
        with tempfile.NamedTemporaryFile(mode='w', prefix='.restore-check.', dir=path, delete=False) as file:
            report_tmp = pathlib.Path(file.name)
        try:
            report_tmp.write_text(json.dumps(report))
            report_tmp.replace(path / 'restore-check.json')
        finally:
            report_tmp.unlink(missing_ok=True)
        print(json.dumps({'restore':'passed','backup':path.name,'storageObjects':int(result)}))
    finally:
        subprocess.run(['docker','rm','-fv',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

if __name__ == '__main__':
    os.umask(0o077)
    signal.signal(signal.SIGTERM, lambda signum, frame: (_ for _ in ()).throw(SystemExit(128 + signum)))
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify',type=pathlib.Path)
    parser.add_argument('--restore-check',type=pathlib.Path)
    parser.add_argument('--restore-latest',action='store_true')
    parser.add_argument('--organize',action='store_true',help='Verify, move legacy backups to dated folders, and retain five of each kind')
    parser.add_argument('--deployment-dir',metavar='LABEL',help='Create a dated directory for a deployment; run --organize after copying archives')
    parser.add_argument('--lock-timeout',type=float,default=0,help='Seconds to wait for backup lock before failing')
    args=parser.parse_args()
    if args.verify:
        with backup_lock(shared=True, wait_seconds=args.lock_timeout): validate(args.verify)
    elif args.restore_check:
        with backup_lock(wait_seconds=args.lock_timeout): restore_check(args.restore_check)
    elif args.restore_latest:
        with backup_lock(wait_seconds=args.lock_timeout):
            snapshots=backup_catalog('full')
            if not snapshots: raise RuntimeError('No completed backup to restore')
            restore_check(snapshots[-1][1])
    elif args.organize:
        with backup_lock(wait_seconds=args.lock_timeout): organize_backups()
    elif args.deployment_dir:
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', args.deployment_dir): parser.error('Deployment label must contain lowercase letters, digits and hyphens')
        with backup_lock(wait_seconds=args.lock_timeout):
            write_backup_readme()
            path=backup_location(datetime.datetime.now(datetime.timezone.utc), 'deploy-' + args.deployment_dir)
            if path.parent.resolve() != path.parent.absolute(): raise RuntimeError('Invalid deployment destination: ' + str(path))
            path.parent.mkdir(mode=0o700, exist_ok=True)
            path.mkdir(mode=0o700)
            print(path)
    else: backup(lock_timeout=args.lock_timeout)
