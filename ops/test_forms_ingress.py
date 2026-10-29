import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class FormsIngressTests(unittest.TestCase):
    def test_protected_ports_and_frontend_allowlist_for_both_ip_families(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mock = root / 'iptables'
            mock.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['INGRESS_TEST_LOG'], 'a') as out:
    out.write(json.dumps([os.path.basename(sys.argv[0]), *sys.argv[1:]]) + '\\n')
sys.exit(1 if '-C' in sys.argv else 0)
''')
            mock.chmod(0o755)
            (root / 'ip6tables').symlink_to(mock)
            log = root / 'calls.jsonl'
            subprocess.run(['sh', str(Path(__file__).with_name('forms-ingress.sh'))], check=True,
                           env={**os.environ, 'PATH': str(root) + ':' + os.environ['PATH'], 'INGRESS_TEST_LOG': str(log)})
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            for family in ['iptables', 'ip6tables']:
                for chain, selector in [('SURVEY_HOST', '--dport'), ('SURVEY_INGRESS', '--ctorigdstport')]:
                    rules = [call for call in calls if call[0] == family and '-A' in call and chain in call and selector in call]
                    dropped = [rule[rule.index(selector) + 1] for rule in rules if rule[-1] == 'DROP']
                    self.assertEqual(dropped, ['8000', '8443', '8095', '5432', '6543'])
                    allowed = [rule for rule in rules if rule[-1] == 'RETURN']
                    self.assertEqual([rule[rule.index(selector) + 1] for rule in allowed], ['8000', '8443', '8095'] if family == 'iptables' else [])
                    self.assertTrue(all(rule[rule.index('-s') + 1] == '192.168.6.99' for rule in allowed))
