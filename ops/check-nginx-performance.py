#!/usr/bin/env python3
"""Exercise repo Nginx configs on loopback with a dummy upstream; never contact the API."""
import concurrent.futures
import http.server
import json
import pathlib
import re
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import sys

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
nginx = sys.argv[2] if len(sys.argv) > 2 else "/usr/sbin/nginx"

class Stub(http.server.BaseHTTPRequestHandler):
    def respond(self):
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")
    do_GET = do_POST = do_OPTIONS = respond
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
    frontend_port, api_port = port(), port()
    source = (root / "nginx.conf").read_text()
    globals_conf = source[:source.index("upstream app_api")]
    api = source[source.index("server {\n  listen 443"):]
    api = re.sub(r"  listen 443 ssl;", f"  listen 127.0.0.1:{api_port};", api)
    api = re.sub(r"^  (?:listen \[::\]:443|http2 |ssl_).*\n", "", api, flags=re.M)
    api = re.sub(r"root /var/www/[^;]+;", f"root {temp};", api)
    frontend = (root / "frontend/nginx.conf").read_text()
    frontend = frontend[frontend.index("server {"):].replace("listen 8080;", f"listen 127.0.0.1:{frontend_port};")
    frontend = frontend.replace("root /usr/share/nginx/html;", f'root {temp};\n  add_header X-Test-Policy new;')
    upstream_port = upstream.server_address[1]
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
  upstream app_api {{ server 127.0.0.1:{upstream_port}; }}
  upstream app_ws {{ server 127.0.0.1:{upstream_port}; }}
  {frontend}
  {api}
}}
"""
    path = temp / "nginx.conf"
    baseline = config.replace("_v2", "").replace("X-Test-Policy new", "X-Test-Policy old")
    baseline = baseline.replace("limit_req_zone $survey_api_key", "limit_req_zone $binary_remote_addr")
    baseline = baseline.replace("limit_req_zone $survey_upload_key", "limit_req_zone $binary_remote_addr")
    baseline = baseline.replace("zone=survey_responses:10m rate=20r/s", "zone=survey_responses:10m rate=3r/s")
    baseline = baseline.replace("zone=survey_responses burst=200", "zone=survey_responses burst=6")
    path.write_text(baseline)
    subprocess.run([nginx, "-p", str(temp), "-c", str(path), "-t"], check=True, capture_output=True)
    subprocess.run([nginx, "-p", str(temp), "-c", str(path)], check=True)
    try:
        def request(port_number, path, method="GET", headers=None):
            req = urllib.request.Request(f"http://127.0.0.1:{port_number}{path}", method=method, headers=headers or {})
            try:
                response = urllib.request.urlopen(req, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                response.read()
                return response.status, dict(response.headers)

        # Reload from the old shared-memory key as well as validating syntax.
        # Reusing old zone names with a different key would reject a live reload.
        path.write_text(config)
        subprocess.run([nginx, "-p", str(temp), "-c", str(path), "-s", "reload"], check=True)
        for attempt in range(100):
            if request(frontend_port, "/assets/app-12345678.js")[1].get("X-Test-Policy") == "new":
                break
            time.sleep(0.02)
        else:
            raise AssertionError("Nginx did not activate the new config during graceful reload")
        time.sleep(0.5)  # allow old workers to stop accepting new connections
        cache_results = []
        for port_number in [frontend_port, api_port]:
            status, headers = request(port_number, "/assets/app-12345678.js")
            assert status == 200 and "immutable" in headers.get("Cache-Control", ""), headers
            assert headers.get("X-Content-Type-Options") == "nosniff"
            assert "Content-Security-Policy" in headers
            status, html_headers = request(port_number, "/dashboard/my")
            assert status == 200 and html_headers.get("Cache-Control") == "no-cache"
            status, missing_headers = request(port_number, "/assets/missing-12345678.js")
            assert status == 404 and "immutable" not in missing_headers.get("Cache-Control", "")
            assert request(port_number, "/assets/app-12345678.js", headers={"If-None-Match": headers["ETag"]})[0] == 304
            cache_results.append({"immutable_assets": True, "html_revalidated": True, "missing_asset_404": True, "security_headers_preserved": True})

        def burst(path, method, count):
            start = time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
                statuses = list(pool.map(lambda _: request(api_port, path, method)[0], range(count)))
            return {"requests": count, "method": method, "seconds": round(time.monotonic() - start, 3), "statuses": {str(status): statuses.count(status) for status in set(statuses)}}

        # Preflights must not spend the response/upload write budgets.
        preflight = burst("/api/rest/v1/rpc/submit_form_response", "OPTIONS", 200)
        responses = burst("/api/rest/v1/rpc/submit_form_response", "POST", 200)
        uploads = burst("/api/storage/v1/object/survey-files/example", "POST", 200)
        reads = burst("/api/storage/v1/object/survey-files/example", "GET", 200)
        assert all(result["statuses"] == {"200": 200} for result in [preflight, responses, uploads, reads]), [preflight, responses, uploads, reads]
        overload = burst("/api/rest/v1/rpc/submit_form_response", "POST", 400)
        assert int(overload["statuses"].get("429", 0)) > 0, overload
        print(json.dumps({"graceful_reload": True, "cache": cache_results, "preflight": preflight, "responses": responses, "uploads": uploads, "reads": reads, "overload": overload}, indent=2))
    finally:
        subprocess.run([nginx, "-p", str(temp), "-c", str(path), "-s", "quit"], check=True)
        upstream.shutdown()
