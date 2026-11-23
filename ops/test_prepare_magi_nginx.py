import pathlib
import subprocess
import sys
import tempfile
import unittest


class PrepareMagiNginxTests(unittest.TestCase):
    def test_renders_both_vhost_paths_and_trusted_upstreams(self):
        script = pathlib.Path(__file__).with_name("prepare-magi-nginx.py")
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory)
            subprocess.run(
                [sys.executable, str(script), "--backend", "192.0.2.80:8000",
                 "--office", "192.0.2.80:8095", "--output", str(output)],
                check=True, capture_output=True,
            )
            shared = (output / "survey-http.conf").read_text()
            forms = (output / "forms-proxy.inc").read_text()
            api = (output / "api-proxy.inc").read_text()
            self.assertIn("server 192.0.2.80:8000;", shared)
            self.assertIn("(?:/api)?/functions/v1/form-admin", shared)
            self.assertIn("proxy_pass http://192.0.2.80:8095;", forms)
            self.assertIn("location = /api/office/probe {", forms)
            self.assertIn("location /api/ {", forms)
            self.assertIn("location / {", api)
            self.assertNotIn("/api/", api)
            for candidate, prefix in [(forms, "/api"), (api, "")]:
                self.assertIn(f"location ^~ {prefix}/storage/v1/upload/resumable", candidate)
                self.assertIn("object/(?:upload/sign/)?survey-files/", candidate)
                self.assertIn('X-Survey-Client-IP $remote_addr', candidate)
                self.assertNotIn('$proxy_add_x_forwarded_for', candidate)
