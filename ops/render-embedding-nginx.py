#!/usr/bin/env python3
"""Render the internal dynamic CSP subrequest. Use the public anon key, never service_role."""
import argparse,json,pathlib,re,urllib.parse
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--config',type=pathlib.Path,required=True)
p.add_argument('--upstream',required=True)
p.add_argument('--anon-key-file',type=pathlib.Path,required=True)
p.add_argument('--output',type=pathlib.Path,required=True)
a=p.parse_args()
key=a.anon_key_file.read_text().strip()
if not re.fullmatch(r'[A-Za-z0-9_.-]+',key):raise SystemExit('Invalid public key')
try:
 import base64
 payload=json.loads(base64.urlsafe_b64decode(key.split('.')[1]+'==='))
 if payload.get('role')!='anon':raise ValueError()
except Exception:raise SystemExit('Expected an anon JWT key')
u=urllib.parse.urlsplit(a.upstream)
if u.scheme not in ('http','https') or not u.netloc or u.path not in ('','/') or u.query or u.fragment:raise SystemExit('Invalid API upstream')
s=a.config.read_text()
if 'location = /__form_embedding_policy' in s:raise SystemExit('Policy is already installed; inspect config')
marker='location ~ ^/form/[^/]+/?$ {'
if marker not in s:raise SystemExit('Expected existing public form block')
subrequest=f'''location = /__form_embedding_policy {{
        internal;
        proxy_pass {a.upstream.rstrip('/')}/rest/v1/rpc/get_form_embedding_policy;
        proxy_method GET;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie "";
        proxy_set_header Authorization "Bearer {key}";
        proxy_set_header apikey "{key}";
        proxy_connect_timeout 3s;
        proxy_read_timeout 5s;
        proxy_buffer_size 32k;
        proxy_buffers 4 32k;
        access_log off;
    }}

    '''
s=s.replace(marker,subrequest+marker+'\n        auth_request /__form_embedding_policy;\n        auth_request_set $survey_frame_ancestors $upstream_http_x_form_frame_ancestors;',1)
start=s.index(marker)
s=s[:start]+re.sub(r'frame-ancestors [^;]*;', 'frame-ancestors $survey_frame_sources;', s[start:], count=1)
s='map $survey_frame_ancestors $survey_frame_sources {\n    default $survey_frame_ancestors;\n    "" "\'none\'";\n}\n\n'+s
a.output.write_text(s)
print('Dynamic embedding CSP config rendered.')
