#!/usr/bin/env python3
"""Render reviewable configs from current magi files. Does not install or reload Nginx."""
import argparse
import pathlib
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--forms", required=True, type=pathlib.Path)
parser.add_argument("--api", required=True, type=pathlib.Path)
parser.add_argument("--output", required=True, type=pathlib.Path)
args = parser.parse_args()
template = (pathlib.Path(__file__).resolve().parents[1] / "nginx.conf").read_text()
policy = template[template.index("# OPTIONS"):template.index("upstream app_api")].strip()
forms = args.forms.read_text()
api = args.api.read_text()
pattern = r"limit_req_zone[^\n]+zone=survey_api[^\n]+;\s*limit_req_zone[^\n]+zone=survey_responses[^\n]+;\s*limit_req_zone[^\n]+zone=survey_uploads[^\n]+;\s*limit_conn_zone[^\n]+zone=survey_connections[^\n]+;"
forms, replaced = re.subn(pattern, lambda _: policy, forms)
if replaced != 1:
    raise SystemExit("Expected one existing application rate-limit block; inspect current config before proceeding")
forms = forms.replace("limit_conn survey_connections 30;", "limit_conn survey_connections 256;")
if "add_header Cache-Control" not in forms:
    forms = forms.replace("\tclient_max_body_size", "\tadd_header Cache-Control $survey_static_cache_control;\n\n\tclient_max_body_size", 1)
if "location ^~ /assets/" not in forms:
    marker = "\tlocation / {\n\t\ttry_files"
    if marker not in forms:
        raise SystemExit("Expected static SPA location not found")
    forms = forms.replace(marker, "\tlocation ^~ /assets/ {\n\t\ttry_files $uri =404;\n\t}\n\n" + marker, 1)
for zone, before, after in [("survey_responses", 6, 200), ("survey_uploads", 5, 200), ("survey_api", 40, 400)]:
    api = api.replace(f"zone={zone} burst={before}", f"zone={zone}_v2 burst={after}")
if "add_header Cache-Control $survey_static_cache_control;" not in forms:
    raise SystemExit("Cache-Control header was not placed; inspect current config")
args.output.mkdir(parents=True, exist_ok=True)
(args.output / "forms.imc-mosk.ru").write_text(forms)
(args.output / "api.forms.imc-mosk.ru").write_text(api)
print(f"Prepared configs in {args.output}; live files unchanged")
