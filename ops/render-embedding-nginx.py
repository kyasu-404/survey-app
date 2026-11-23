#!/usr/bin/env python3
"""Render a rate-limited, cached nginx subrequest for the public iframe policy."""
import argparse
import base64
import ipaddress
import json
import pathlib
import re
from urllib.parse import urlsplit

FORM_LOCATION = 'location ~ ^/form/[^/]+/?$ {'
POLICY_FAILURES = '301 302 303 307 308 400 401 403 404 405 406 408 409 410 415 422 425 429 500 501 502 503 504'


def upstream_address(value):
    if re.search(r'[^a-zA-Z0-9./:[\]-]', value):
        raise ValueError('Expected a literal HTTP(S) upstream origin')
    address = urlsplit(value)
    if address.scheme not in ('http', 'https') or not address.hostname or address.path not in ('', '/') or address.port == 0:
        raise ValueError('Expected a literal HTTP(S) upstream origin')
    if ':' in address.hostname:
        ipaddress.IPv6Address(address.hostname)
    return address


def anon_jwt(path):
    key = path.read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', key):
        raise ValueError('Expected an anon JWT key')
    try:
        payload = json.loads(base64.urlsafe_b64decode(key.split('.')[1] + '==='))
        if payload.get('role') == 'anon':
            return key
    except (ValueError, AttributeError):
        pass
    raise ValueError('Expected an anon JWT key')


def render(config, address, key, cache_path):
    if 'location = /__form_embedding_policy' in config:
        raise ValueError('Policy is already installed; inspect config')
    if config.count(FORM_LOCATION) != 1:
        raise ValueError('Expected one existing public form block')
    if not re.fullmatch(r'/[a-zA-Z0-9_./-]+', cache_path) or '..' in pathlib.PurePosixPath(cache_path).parts:
        raise ValueError('Expected an absolute cache path without spaces or traversal')

    prefix = (
        f'proxy_cache_path {cache_path} levels=1:2 keys_zone=survey_embed_policy:2m '
        'max_size=32m inactive=5m use_temp_path=off;\n'
        'map $survey_frame_ancestors $survey_frame_sources {\n'
        '    default $survey_frame_ancestors;\n'
        '    "" "\'none\'";\n'
        '}\n\n'
    )
    start = config.index(FORM_LOCATION)
    end = config.index('\n', start)
    tail = config[end:]
    stop = re.search(r'^\s*}', tail, re.M)
    if not stop:
        raise ValueError('Malformed public form block')
    form, rest = tail[:stop.start()], tail[stop.start():]
    form, replaced = re.subn(r'frame-ancestors [^;]*;', 'frame-ancestors $survey_frame_sources;', form, count=1)
    if replaced != 1:
        raise ValueError('Missing frame-ancestors directive on the public form block')
    if not re.search(r'^\s*limit_req\s', form, re.M):
        prefix += 'limit_req_zone $binary_remote_addr zone=survey_embed_form_pages:1m rate=20r/s;\n\n'
        form = '\n        limit_req zone=survey_embed_form_pages burst=100 nodelay;' + form

    tls = ''
    if address.scheme == 'https':
        tls = (
            '        proxy_ssl_server_name on;\n'
            '        proxy_ssl_verify on;\n'
            '        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;\n'
        )
    subrequest = f'''location = /__form_embedding_policy {{
        internal;
        proxy_pass {address.scheme}://{address.netloc}/rest/v1/rpc/get_form_embedding_policy;
        proxy_method GET;
        proxy_http_version 1.1;
{tls}        proxy_set_header Connection "";
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie "";
        proxy_set_header Authorization "Bearer {key}";
        proxy_set_header apikey "{key}";
        proxy_cache survey_embed_policy;
        proxy_cache_key "form_embedding_policy";
        proxy_cache_valid 200 10s;
        proxy_ignore_headers Cache-Control;
        proxy_cache_lock on;
        proxy_intercept_errors on;
        error_page {POLICY_FAILURES} = @form_embedding_policy_fallback;
        proxy_connect_timeout 3s;
        proxy_send_timeout 5s;
        proxy_read_timeout 5s;
        proxy_buffer_size 32k;
        proxy_buffers 4 32k;
        access_log off;
    }}

    location @form_embedding_policy_fallback {{
        return 200;
    }}

    '''
    policy = '\n        auth_request /__form_embedding_policy;\n        auth_request_set $survey_frame_ancestors $upstream_http_x_form_frame_ancestors;'
    return prefix + config[:start] + subrequest + FORM_LOCATION + policy + form + rest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=pathlib.Path, required=True)
    parser.add_argument('--upstream', required=True)
    parser.add_argument('--anon-key-file', type=pathlib.Path, required=True)
    parser.add_argument('--output', type=pathlib.Path, required=True)
    parser.add_argument('--cache-path', default='/var/cache/nginx/survey_embed')
    args = parser.parse_args()
    try:
        output = render(args.config.read_text(), upstream_address(args.upstream), anon_jwt(args.anon_key_file), args.cache_path)
    except ValueError as error:
        parser.error(str(error))
    args.output.write_text(output)
    print('Dynamic embedding CSP config rendered.')


if __name__ == '__main__':
    main()
