import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class FormsIngressTests(unittest.TestCase):
    def run_ingress(self, *args, missing_docker_ipv6=False, invalid_ipv6=False, **config):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mock = root / 'iptables'
            mock.write_text('''#!/usr/bin/env python3
import json, os, sys
name = os.path.basename(sys.argv[0])
if name.endswith('-restore'):
    with open(os.environ['INGRESS_TEST_LOG'], 'a') as out:
        out.write(json.dumps([name, sys.argv[1:], sys.stdin.read()]) + '\\n')
    sys.exit(int(name == 'ip6tables-restore' and os.environ['INGRESS_TEST_INVALID'] == '1'))
if '-S' in sys.argv:
    print('-P INPUT ACCEPT')
    print('-N SURVEY_HOST')
    print('-A INPUT -i enp7s0 -j SURVEY_HOST')
    if not (name == 'ip6tables' and os.environ['INGRESS_TEST_MISSING'] == '1'):
        print('-N DOCKER-USER')
        print('-N SURVEY_INGRESS')
        print('-A DOCKER-USER -i enp7s0 -j SURVEY_INGRESS')
''')
            mock.chmod(0o755)
            for name in ['ip6tables', 'iptables-restore', 'ip6tables-restore']:
                (root / name).symlink_to(mock)
            log = root / 'calls.jsonl'
            env = {key: value for key, value in os.environ.items() if not key.startswith('SURVEY_INGRESS_') and not key.startswith('SURVEY_FRONTEND_')}
            result = subprocess.run(
                ['sh', str(Path(__file__).with_name('forms-ingress.sh')), *args],
                env={**env, 'PATH': str(root) + ':' + os.environ['PATH'], 'INGRESS_TEST_LOG': str(log),
                     'INGRESS_TEST_MISSING': str(int(missing_docker_ipv6)),
                     'INGRESS_TEST_INVALID': str(int(invalid_ipv6)),
                     'SURVEY_INGRESS_LOCK_FILE': str(root / 'lock'), **config},
                capture_output=True, text=True,
            )
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def test_refresh_applies_one_filter_transaction_per_family_and_protects_non_loopback(self):
        result, calls = self.run_ingress()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([call[0] for call in calls], ['iptables-restore', 'ip6tables-restore'] * 2)
        for family, flags, config in calls:
            self.assertIn('--noflush', flags)
            self.assertTrue(config.startswith('*filter\n'))
            self.assertTrue(config.endswith('COMMIT\n'))
            for parent, chain, selector in [('INPUT', 'SURVEY_HOST', '--dport'),
                                             ('DOCKER-USER', 'SURVEY_INGRESS', '--ctorigdstport')]:
                self.assertIn(f'-D {parent} -i enp7s0 -j {chain}', config)
                self.assertIn(f'-I {parent} 1 ! -i lo -j {chain}', config)
                rules = [line.split() for line in config.splitlines() if line.startswith(f'-A {chain} ') and selector in line]
                dropped = [rule[rule.index(selector) + 1] for rule in rules if rule[-1] == 'DROP']
                self.assertEqual(dropped, ['8000', '8443', '8095', '5432', '6543'])
                allowed = [rule for rule in rules if rule[-1] == 'RETURN']
                self.assertEqual([rule[rule.index(selector) + 1] for rule in allowed],
                                 ['8000', '8443', '8095'] if family == 'iptables-restore' else [])
                self.assertTrue(all(rule[rule.index('-s') + 1] == '192.168.6.99' for rule in allowed))

    def test_missing_ipv6_docker_user_preserves_input_protection(self):
        result, calls = self.run_ingress(missing_docker_ipv6=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        [ipv6] = [body for family, flags, body in calls if family == 'ip6tables-restore' and '--test' not in flags]
        self.assertIn('-I INPUT 1 ! -i lo -j SURVEY_HOST', ipv6)
        self.assertNotIn('DOCKER-USER', ipv6)

    def test_invalid_family_does_not_apply_either_transaction(self):
        result, calls = self.run_ingress(invalid_ipv6=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 2)
        self.assertTrue(all('--test' in flags for _, flags, _ in calls))

    def test_override_and_remove_replace_previous_interface_rules(self):
        result, calls = self.run_ingress(SURVEY_INGRESS_INTERFACES='wg0 eth0', SURVEY_FRONTEND_IPV6='2001:db8::1')
        self.assertEqual(result.returncode, 0, result.stderr)
        [ipv6] = [body for family, flags, body in calls if family == 'ip6tables-restore' and '--test' not in flags]
        self.assertIn('-I INPUT 1 -i wg0 -j SURVEY_HOST', ipv6)
        self.assertIn('-I INPUT 1 -i eth0 -j SURVEY_HOST', ipv6)
        self.assertIn('-s 2001:db8::1 -j RETURN', ipv6)
        result, calls = self.run_ingress('--remove')
        self.assertEqual(result.returncode, 0, result.stderr)
        for _, _, body in calls:
            self.assertIn('-D INPUT -i enp7s0 -j SURVEY_HOST', body)
            self.assertIn('-X SURVEY_HOST', body)
            self.assertNotIn('-I INPUT', body)
