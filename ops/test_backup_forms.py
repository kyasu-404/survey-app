import contextlib
import datetime
import gzip
import importlib.util
import io
import json
import os
import pathlib
import tarfile
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('backup_forms', pathlib.Path(__file__).with_name('backup-forms.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name)
        self.patch = mock.patch.object(backup, 'BASE', self.base)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def moment(self, stamp):
        return datetime.datetime.strptime(stamp, backup.STAMP_FORMAT).replace(tzinfo=datetime.timezone.utc)

    def full(self, stamp, legacy=False):
        path = self.base / stamp if legacy else backup.backup_location(self.moment(stamp))
        path.mkdir(parents=True)
        (path / 'postgres.dump').write_bytes(('snapshot:' + stamp).encode())
        (path / 'manifest.json').write_text(json.dumps({
            'createdAt': stamp, 'objects': [],
            'sha256': {'postgres.dump': backup.digest(path / 'postgres.dump')},
        }))
        return path

    def deployment(self, stamp, legacy=False):
        path = self.base / ('deploy-ui-' + stamp) if legacy else backup.backup_location(self.moment(stamp), 'deploy-ui')
        path.mkdir(parents=True)
        with tarfile.open(path / 'magi-before.tar.gz', 'w:gz') as archive:
            body = b'old frontend'
            member = tarfile.TarInfo('dist/index.html')
            member.size = len(body)
            archive.addfile(member, io.BytesIO(body))
        (path / 'deployment.json').write_text(json.dumps({'frontendBackupSha256': backup.digest(path / 'magi-before.tar.gz')}))
        return path

    def test_migration_uses_moscow_date_preserves_hard_links_and_is_repeatable(self):
        old = self.full('20260921T220000Z', legacy=True)
        deployment = self.deployment('20260921T210000Z', legacy=True)
        linked = self.base / 'keep-hard-link'
        os.link(old / 'postgres.dump', linked)
        old_inode = linked.stat().st_ino
        backup.organize_backups()
        target = self.base / '2026-09-22/01-00-00-full'
        self.assertFalse(old.exists())
        self.assertFalse(deployment.exists())
        self.assertEqual((target / 'postgres.dump').stat().st_ino, old_inode)
        self.assertTrue((self.base / '2026-09-22/00-00-00-deploy-ui/magi-before.tar.gz').is_file())
        backup.validate(target)
        backup.organize_backups()
        self.assertEqual(len(backup.backup_catalog('full')), 1)
        self.assertEqual((self.base / 'README.md').read_text(), pathlib.Path(backup.__file__).with_name('BACKUP_FILES.md').read_text())

    def test_retention_keeps_five_of_each_type_and_removes_empty_dates(self):
        full = [self.full(f'202609{day:02d}T000000Z', legacy=day % 2 == 0) for day in range(10, 17)]
        deployments = [self.deployment(f'202609{day:02d}T010000Z', legacy=day % 2 == 0) for day in range(10, 18)]
        backup.organize_backups()
        kept_full = [entry[0] for entry in backup.backup_catalog('full')]
        kept_deployments = [entry[0] for entry in backup.backup_catalog('deploy')]
        self.assertEqual(kept_full, [self.moment(f'202609{day:02d}T000000Z') for day in range(12, 17)])
        self.assertEqual(kept_deployments, [self.moment(f'202609{day:02d}T010000Z') for day in range(13, 18)])
        self.assertFalse((self.base / '2026-09-10').exists())
        self.assertFalse((self.base / '2026-09-11').exists())
        self.assertEqual(len(full), 7)
        self.assertEqual(len(deployments), 8)

    def test_partial_unknown_and_symlinked_directories_are_not_rotated(self):
        real = self.full('20260921T000000Z')
        partial = self.base / '2026-09-21/.partial-13-00-00-full'
        partial.mkdir()
        (partial / 'manifest.json').write_text((real / 'manifest.json').read_text())
        unknown = self.base / 'manual-keep'
        unknown.mkdir()
        link = self.base / '20260922T000000Z'
        link.symlink_to(real, target_is_directory=True)
        backup.organize_backups()
        self.assertEqual(len(backup.backup_catalog('full')), 1)
        self.assertTrue(partial.exists())
        self.assertTrue(unknown.exists())
        self.assertTrue(link.is_symlink())

    def test_collision_stops_before_renaming_or_deleting_anything(self):
        old = self.full('20260921T220000Z', legacy=True)
        target = backup.backup_location(self.moment('20260921T220000Z'))
        target.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            backup.organize_backups()
        self.assertTrue((old / 'postgres.dump').exists())
        self.assertTrue(target.exists())

    def test_corrupt_snapshot_stops_migration_and_retention(self):
        copies = [self.full(f'202609{day:02d}T000000Z', legacy=True) for day in range(10, 16)]
        (copies[-1] / 'postgres.dump').write_bytes(b'corrupted')
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            backup.organize_backups()
        self.assertTrue(all(path.exists() for path in copies))

    def test_corrupt_latest_deployment_preserves_older_copies(self):
        copies = [self.deployment(f'202609{day:02d}T000000Z') for day in range(10, 16)]
        (copies[-1] / 'magi-before.tar.gz').write_bytes(b'broken archive')
        with self.assertRaises((tarfile.ReadError, gzip.BadGzipFile)):
            backup.prune_backups('deploy')
        self.assertTrue(all(path.exists() for path in copies))

    def test_archive_with_missing_gzip_trailer_is_rejected_without_metadata(self):
        path = self.deployment('20260922T000000Z')
        (path / 'deployment.json').unlink()
        archive = path / 'magi-before.tar.gz'
        archive.write_bytes(archive.read_bytes()[:-8])
        with self.assertRaises(EOFError):
            backup.validate_deployment(path)

    def test_deployment_checksum_mismatch_preserves_older_copies(self):
        copies = [self.deployment(f'202609{day:02d}T000000Z') for day in range(10, 16)]
        (copies[-1] / 'SHA256SUMS').write_text('0' * 64 + '  magi-before.tar.gz\n')
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            backup.prune_backups('deploy')
        self.assertTrue(all(path.exists() for path in copies))

    def test_failed_backup_never_prunes_existing_snapshots(self):
        copies = [self.full(f'202609{day:02d}T000000Z') for day in range(10, 16)]
        with mock.patch.object(backup.os.path, 'ismount', return_value=True), mock.patch.object(backup, 'run', side_effect=RuntimeError('disk full')):
            with self.assertRaisesRegex(RuntimeError, 'disk full'):
                backup.backup()
        self.assertTrue(all(path.exists() for path in copies))
        self.assertEqual(len(backup.backup_catalog('full')), 6)
        self.assertEqual(len(list(self.base.glob('*/.partial-*'))), 1)

    def test_verification_lock_prevents_pruning_during_restore(self):
        with mock.patch.object(backup.os.path, 'ismount', return_value=True):
            with backup.backup_lock(shared=True):
                with backup.backup_lock(shared=True): pass
                with self.assertRaises(BlockingIOError):
                    with backup.backup_lock(): pass


if __name__ == '__main__':
    unittest.main()
