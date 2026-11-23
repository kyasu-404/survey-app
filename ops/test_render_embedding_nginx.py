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
            self.assertIn("proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;", rendered)
            self.assertIn("error_page 500 502 503 504 = @form_embedding_policy_fallback;", rendered)
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
