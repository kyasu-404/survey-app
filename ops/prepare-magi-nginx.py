#!/usr/bin/env python3
"""Render reviewable application routes for the two MAGI server blocks."""
import argparse
import ipaddress
import pathlib
import re


def host_port(value):
    match = re.fullmatch(r'(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):([1-9][0-9]{0,4})', value)
    if not match or int(match[2]) > 65535:
        raise argparse.ArgumentTypeError('Expected a DNS name or literal IP address with a TCP port')
    if value.startswith('['):
        try:
            ipaddress.IPv6Address(match[1][1:-1])
        except ValueError as error:
            raise argparse.ArgumentTypeError('Invalid IPv6 address') from error
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=host_port, required=True, help='STSS gateway host:port as reached from MAGI')
    parser.add_argument('--office', type=host_port, required=True, help='STSS Office API host:port as reached from MAGI')
    parser.add_argument('--output', required=True, type=pathlib.Path)
    args = parser.parse_args()

    template = (pathlib.Path(__file__).resolve().parents[1] / "nginx.conf").read_text()
    http = template[:template.index('server {\n  listen 80;')]
    http = http.replace('127.0.0.1:8000', args.backend)
    office = template[template.index('  # Signed document/probe URLs'):template.index('  # --- FRONT ---')]
    office = office.replace('127.0.0.1:8095', args.office)
    same_host_api = template[template.index('  # All response writes'):template.index('\n}\n\n# Optional dedicated')]
    api_host = same_host_api.replace('    rewrite ^/api/(.*)$ /$1 break;\n', '')
    api_host = api_host.replace('proxy_pass http://app_api/;', 'proxy_pass http://app_api;')
    api_host = api_host.replace('/api/', '/')

    args.output.mkdir(parents=True, exist_ok=True)
    for name, config in {'survey-http.conf': http, 'forms-proxy.inc': office + same_host_api,
                         'api-proxy.inc': api_host}.items():
        (args.output / name).write_text(config.rstrip() + '\n')
    print(f'Prepared shared http directives and both proxy route sets in {args.output}; live files unchanged')


if __name__ == '__main__':
    main()
