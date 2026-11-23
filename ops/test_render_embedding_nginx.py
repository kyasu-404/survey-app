import base64
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


def make_jwt(role: str) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return f"{header}.{payload}.sig"


class RenderEmbeddingNginxTests(unittest.TestCase):
    def test_renderer_limits_a_frontend_vhost_that_has_no_existing_form_budget(self):
        script = pathlib.Path(__file__).with_name("render-embedding-nginx.py")
        config = script.parent.parent / "frontend" / "nginx.conf"
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            key = root / "anon.key"
            key.write_text(make_jwt("anon"))
            output = root / "frontend.conf"
            args = [sys.executable, str(script), "--config", str(config), "--anon-key-file", str(key), "--output", str(output)]
            subprocess.run([*args, "--upstream", "http://gateway.example.test:8000", "--cache-path", str(root / "cache")], check=True)
            rendered = output.read_text()
            self.assertIn(str(root / "cache"), rendered)
            form = rendered.split("location ~ ^/form/[^/]+/?$ {")[1].split("}")[0]
            self.assertRegex(form, r"limit_req zone=\w+ burst=\d+ nodelay;")
            for url in ["https://user@gateway.example.test", "https://gateway.example.test:0", "https://gateway.example.test/path", "http://host;test"]:
                result = subprocess.run([*args, "--upstream", url], capture_output=True)
                self.assertNotEqual(result.returncode, 0, url)

    def test_renders_cached_fail_closed_embedding_policy_and_rejects_service_role(self):
        script = pathlib.Path(__file__).with_name("render-embedding-nginx.py")
        nginx_conf = script.parent.parent / "nginx.conf"

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            anon_key = root / "anon.key"
            anon_key.write_text(make_jwt("anon"))
            output = root / "rendered.conf"

            subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--config",
                    str(nginx_conf),
                    "--upstream",
                    "https://api.example.test",
                    "--anon-key-file",
                    str(anon_key),
                    "--output",
                    str(output),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            rendered = output.read_text()
            self.assertIn("proxy_cache_path /var/cache/nginx/survey_embed", rendered)
            self.assertIn("proxy_cache survey_embed_policy;", rendered)
            self.assertIn("proxy_cache_lock on;", rendered)
            self.assertNotIn("proxy_cache_use_stale", rendered)
            self.assertIn("proxy_ssl_verify on;", rendered)
            self.assertRegex(rendered, r"error_page [\d ]*401 [\d ]*429 [\d ]*503 [\d ]*= @form_embedding_policy_fallback;")
            self.assertIn("location @form_embedding_policy_fallback {", rendered)
            self.assertIn("frame-ancestors $survey_frame_sources;", rendered)

            service_key = root / "service.key"
            service_key.write_text(make_jwt("service_role"))
            bad = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--config",
                    str(nginx_conf),
                    "--upstream",
                    "https://api.example.test",
                    "--anon-key-file",
                    str(service_key),
                    "--output",
                    str(root / "bad.conf"),
                ],
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(bad.returncode, 0)


if __name__ == "__main__":
    unittest.main()
