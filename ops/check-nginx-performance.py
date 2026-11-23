#!/usr/bin/env python3
"""Exercise repo Nginx configs on loopback with a dummy upstream; never contact the API."""
import concurrent.futures
import http.server
import http.client
import json
import os
import pathlib
import re
import socket
import subprocess
import tempfile
import threading
import time
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
nginx = sys.argv[2] if len(sys.argv) > 2 else "/usr/sbin/nginx"

class Stub(http.server.BaseHTTPRequestHandler):
    policy_calls = 0
    policy_status = 200
    policy_lock = threading.Lock()

    def respond(self):
        if self.path == "/rest/v1/rpc/get_form_embedding_policy":
            with self.policy_lock:
                type(self).policy_calls += 1
                status = self.policy_status
            self.send_response(status)
            if status == 200:
                self.send_header("X-Form-Frame-Ancestors", "https://embed.example.test")
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_response(200)
            self.send_header("Cache-Control", "private")
        self.send_header("Content-Length", "2")
        self.send_header("X-Upstream-Path", self.path)
        self.send_header("X-Survey-Client-IP", self.headers.get("X-Survey-Client-IP", ""))
        self.end_headers()
        self.wfile.write(b"ok")
    do_GET = do_POST = do_PUT = do_OPTIONS = respond
    def log_message(self, *args):
        pass

def port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]

class StubServer(http.server.ThreadingHTTPServer):
    request_queue_size = 256

upstream = StubServer(("127.0.0.1", 0), Stub)
threading.Thread(target=upstream.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix="survey-nginx-test-") as directory:
    temp = pathlib.Path(directory)
    assets = temp / "assets"
    assets.mkdir()
    (temp / "index.html").write_text("<html>test</html>")
    (assets / "app-12345678.js").write_text("console.log('cache');" * 100)
    frontend_port, api_port, redirect_port, direct_api_port = port(), port(), port(), port()
    source = (root / "nginx.conf").read_text()
    redirect = source[source.index("server {\n  listen 80;"):source.index("server {\n  listen 443")]
    redirect = re.sub(r"^  listen .*;$", "", redirect, flags=re.M)
    redirect = redirect.replace("server {", f"server {{\n  listen 127.0.0.1:{redirect_port};", 1)
    api = source[source.index("server {\n  listen 443"):]
    api = re.sub(r"  listen 443 ssl;", f"  listen 127.0.0.1:{api_port};", api)
    api = re.sub(r"^  (?:listen \[::\]:443|http2 |ssl_).*\n", "", api, flags=re.M)
    api = re.sub(r"root /var/www/[^;]+;", f"root {temp};", api)
    frontend = (root / "frontend/nginx.conf").read_text()
    # The standalone config has its own cache-header map. This harness uses
    # the shared map from the root config and preserves any standalone limits.
    frontend = re.sub(r"map \$uri \$survey_static_cache_control \{.*?^}\n", "", frontend, flags=re.S | re.M)
    frontend = frontend.replace("limit_req_status 429;\n", "").replace("listen 8080;", f"listen 127.0.0.1:{frontend_port};")
    frontend = frontend.replace("root /usr/share/nginx/html;", f'root {temp};\n  add_header X-Test-Policy new;')
    upstream_port = upstream.server_address[1]
    input_path = temp / "frontend.conf"
    output_path = temp / "frontend-rendered.conf"
    key_path = temp / "anon-jwt"
    template_path = temp / "frontend-template.conf"
    template_path.write_text(frontend)
    subprocess.run(["node", str(root / "frontend/scripts/render-nginx-config.mjs"), str(template_path), str(input_path)],
                   env={**os.environ, "VITE_SUPABASE_URL": "https://backend.example.test", "VITE_SENTRY_DSN": ""},
                   check=True)
    key_path.write_text("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fixture")
    subprocess.run([sys.executable, str(root / "ops/render-embedding-nginx.py"), "--config", str(input_path),
                    "--upstream", f"http://127.0.0.1:{upstream_port}", "--anon-key-file", str(key_path),
                    "--cache-path", str(temp / "embed"), "--output", str(output_path)], check=True)
    frontend = output_path.read_text().replace("proxy_cache_valid 200 10s;", "proxy_cache_valid 200 1s;")
    magi_config = temp / "magi"
    upstream_address = f"127.0.0.1:{upstream_port}"
    subprocess.run([sys.executable, str(root / "ops/prepare-magi-nginx.py"), "--backend", upstream_address,
                    "--office", upstream_address, "--output", str(magi_config)], check=True)
    globals_conf = (magi_config / "survey-http.conf").read_text()
    direct_api = (magi_config / "api-proxy.inc").read_text()
    api = api.replace("proxy_pass http://127.0.0.1:8095;", f"proxy_pass http://127.0.0.1:{upstream_port};")
    config = f"""pid {temp}/nginx.pid;
error_log {temp}/error.log;
events {{ worker_connections 1024; }}
http {{
  access_log off;
  client_body_temp_path {temp}/body;
  proxy_temp_path {temp}/proxy;
  fastcgi_temp_path {temp}/fastcgi;
  uwsgi_temp_path {temp}/uwsgi;
  scgi_temp_path {temp}/scgi;
  types {{ text/html html; application/javascript js; text/css css; }}
  {globals_conf}
  server {{
    listen 127.0.0.1:{direct_api_port};
    {direct_api}
  }}
  {frontend}
  {api}
  {redirect}
}}
"""
    config_path = temp / "nginx.conf"
    baseline = config.replace("_v2", "").replace("_v1", "").replace("X-Test-Policy new", "X-Test-Policy old")
    baseline = baseline.replace("limit_req_zone $survey_api_key", "limit_req_zone $binary_remote_addr")
    baseline = baseline.replace("limit_req_zone $survey_upload_key", "limit_req_zone $binary_remote_addr")
    baseline = baseline.replace("zone=survey_responses:10m rate=20r/s", "zone=survey_responses:10m rate=3r/s")
    baseline = baseline.replace("zone=survey_responses burst=200", "zone=survey_responses burst=6")
    config_path.write_text(baseline)
    subprocess.run([nginx, "-p", str(temp), "-c", str(config_path), "-t"], check=True, capture_output=True)
    subprocess.run([nginx, "-p", str(temp), "-c", str(config_path)], check=True)
    try:
        def request(port_number, path, method="GET", headers=None, source_ip="127.0.0.1"):
            connection = http.client.HTTPConnection("127.0.0.1", port_number, timeout=15, source_address=(source_ip, 0))
            try:
                connection.request(method, path, headers=headers or {})
                response = connection.getresponse()
                response.read()
                return response.status, dict(response.getheaders())
            finally:
                connection.close()

        # Reload from the old shared-memory key as well as validating syntax.
        # Reusing old zone names with a different key would reject a live reload.
        config_path.write_text(config)
        subprocess.run([nginx, "-p", str(temp), "-c", str(config_path), "-s", "reload"], check=True)
        for attempt in range(100):
            if request(frontend_port, "/assets/app-12345678.js")[1].get("X-Test-Policy") == "new":
                break
            time.sleep(0.02)
        else:
            raise AssertionError("Nginx did not activate the new config during graceful reload\n" + (temp / "error.log").read_text())
        time.sleep(0.5)  # allow old workers to stop accepting new connections
        cache_results = []
        for port_number in [frontend_port, api_port]:
            status, headers = request(port_number, "/assets/app-12345678.js")
            assert status == 200 and "immutable" in headers.get("Cache-Control", ""), headers
            assert headers.get("X-Content-Type-Options") == "nosniff"
            assert "Content-Security-Policy" in headers
            status, html_headers = request(port_number, "/dashboard/my")
            assert status == 200 and html_headers.get("Cache-Control") == "no-cache"
            for protected_path in ["/dashboard/my", "/settings", "/login", "/form/example/extra", "/form/%2e%2e/settings"]:
                status, protected_headers = request(port_number, protected_path)
                assert status == 200
                assert "frame-ancestors 'none'" in protected_headers["Content-Security-Policy"], protected_headers
                assert protected_headers.get("X-Frame-Options") == "DENY", protected_headers
            for public_path in ["/form/20000000-0000-4000-8000-000000000001", "/form/example/?source=website"]:
                status, embed_headers = request(port_number, public_path)
                assert status == 200 and embed_headers.get("Cache-Control") == "no-cache", embed_headers
                assert "frame-ancestors " in embed_headers["Content-Security-Policy"] and "frame-ancestors *" not in embed_headers["Content-Security-Policy"], embed_headers
                assert "X-Frame-Options" not in embed_headers, embed_headers
                assert embed_headers.get("X-Content-Type-Options") == "nosniff", embed_headers
            status, missing_headers = request(port_number, "/assets/missing-12345678.js")
            assert status == 404 and "immutable" not in missing_headers.get("Cache-Control", "")
            assert request(port_number, "/assets/app-12345678.js", headers={"If-None-Match": headers["ETag"]})[0] == 304
            cache_results.append({"immutable_assets": True, "html_revalidated": True, "missing_asset_404": True, "security_headers_preserved": True})

        status, redirect_headers = request(redirect_port, "/form/example?source=website")
        assert status == 301 and redirect_headers["Location"] == "https://example.com/form/example?source=website", redirect_headers
        status, api_headers = request(api_port, "/api/rest/v1/forms")
        assert status == 200 and api_headers.get("Cache-Control") == "private", api_headers
        for port_number in [frontend_port, api_port]:
            headers = request(port_number, "/settings")[1]
            connect = next(directive for directive in headers["Content-Security-Policy"].split(";") if directive.strip().startswith("connect-src "))
            assert "https:" not in connect.split() and "wss:" not in connect.split(), connect

        # Expiry followed by an upstream error keeps top-level forms available,
        # while denying iframe access with the default policy. 401 and 429
        # also use this path instead of blocking the top-level route.
        assert "frame-ancestors https://embed.example.test" in request(frontend_port, "/form/embeddable")[1]["Content-Security-Policy"]
        with Stub.policy_lock:
            cached_calls = Stub.policy_calls
        assert request(frontend_port, "/form/embeddable")[0] == 200
        with Stub.policy_lock:
            assert Stub.policy_calls == cached_calls
        time.sleep(2.0)
        for policy_error in [401, 429, 503]:
            with Stub.policy_lock:
                Stub.policy_status = policy_error
            status, headers = request(frontend_port, "/form/embeddable")
            assert status == 200 and "frame-ancestors 'none'" in headers["Content-Security-Policy"], (policy_error, status, headers)
        with Stub.policy_lock:
            internal_calls = Stub.policy_calls
        _, internal_headers = request(frontend_port, "/__form_embedding_policy")
        assert "X-Form-Frame-Ancestors" not in internal_headers
        with Stub.policy_lock:
            assert Stub.policy_calls == internal_calls

        def burst(path, method, count, source_ip="127.0.0.1"):
            start = time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
                statuses = list(pool.map(lambda _: request(api_port, path, method, source_ip=source_ip)[0], range(count)))
            return {"requests": count, "method": method, "seconds": round(time.monotonic() - start, 3), "statuses": {str(status): statuses.count(status) for status in set(statuses)}}

        # Preflights must not spend the response/upload write budgets.
        preflight = burst("/api/rest/v1/rpc/submit_form_response", "OPTIONS", 200)
        responses = burst("/api/rest/v1/rpc/submit_form_response", "POST", 200)
        uploads = burst("/api/storage/v1/object/survey-files/example", "POST", 200)
        reads = burst("/api/storage/v1/object/survey-files/example", "GET", 200)
        assert all(result["statuses"] == {"200": 200} for result in [preflight, responses, uploads, reads]), [preflight, responses, uploads, reads]
        overload = burst("/api/rest/v1/rpc/submit_form_response", "POST", 400)
        assert int(overload["statuses"].get("429", 0)) > 0, overload
        rpc_paths = [f"/api/rest/v1/rpc/{name}" for name in [
            "submit_form_response", "submit_personal_form_response", "update_form_response", "update_personal_form_response"
        ]]
        for path in rpc_paths:
            status, forwarded = request(api_port, path + "/?test=1", "POST", {"X-Survey-Client-IP": "untrusted"}, "127.0.0.2")
            assert status == 200 and forwarded["X-Upstream-Path"] == path.removeprefix("/api") + "/?test=1", (status, forwarded)
            assert forwarded["X-Survey-Client-IP"] == "127.0.0.2"
        # Reuse one actual source IP: changing RPC, suffix or caller headers must
        # not create a new budget. OPTIONS still succeeds after budget exhaustion.
        protected = []
        for path in rpc_paths + ["/api/rest/v1/rpc/%75pdate_form_response/"]:
            result = burst(path, "POST", 300, "127.0.0.2")
            assert result["statuses"].get("429", 0) > 0, (path, result)
            assert request(api_port, path, "OPTIONS", source_ip="127.0.0.2")[0] == 200
            protected.append({"path": path, **result})
        for path, source_ip in [("/api/functions/v1/form-admin", "127.0.0.3"),
                                ("/api/functions/v1/form-admin/extra", "127.0.0.3"),
                                ("/api/office/documents/example/generate", "127.0.0.4")]:
            result = burst(path, "POST", 350, source_ip)
            assert result["statuses"].get("429", 0) > 0, (path, result)
            assert request(api_port, path, "OPTIONS", source_ip=source_ip)[0] == 200
            protected.append({"path": path, **result})
        signed_path = "/api/storage/v1/object/upload/sign/survey-files/example"
        status, signed_headers = request(api_port, signed_path, "PUT", source_ip="127.0.0.6")
        assert status == 200 and signed_headers["X-Upstream-Path"] == signed_path.removeprefix("/api"), signed_headers
        signed = burst(signed_path, "PUT", 250, "127.0.0.6")
        assert signed["statuses"].get("429", 0) > 0, signed
        assert request(api_port, "/api/storage/v1/upload/resumable", "POST")[0] == 403
        direct_signed_path = signed_path.removeprefix("/api")
        status, headers = request(direct_api_port, direct_signed_path, "PUT", source_ip="127.0.0.7")
        assert status == 200 and headers["X-Upstream-Path"] == direct_signed_path, (status, headers)
        assert request(direct_api_port, "/storage/v1/upload/resumable", "POST")[0] == 403
        for path in ["/api/office/plugin/config.json", "/api/office/file/example?token=test", "/api/office/probe?token=test"]:
            assert request(api_port, path, source_ip="127.0.0.5")[0] == 200
        assert request(api_port, "/api/office/callback/example", "POST", source_ip="127.0.0.5")[0] == 200
        print(json.dumps({"graceful_reload": True, "cache": cache_results, "preflight": preflight, "responses": responses, "uploads": uploads, "reads": reads, "overload": overload, "protected_routes": protected, "signed_upload": signed}, indent=2))
    finally:
        subprocess.run([nginx, "-p", str(temp), "-c", str(config_path), "-s", "quit"], check=True)
        upstream.shutdown()
