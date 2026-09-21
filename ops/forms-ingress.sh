#!/bin/sh
# Production STSS only. Leave other Docker applications and SSH rules untouched.
set -eu
mode=${1:-apply}
iface=${SURVEY_INGRESS_INTERFACE:-enp7s0}
frontend=${SURVEY_FRONTEND_IP:-192.168.6.99}
for ipt in iptables ip6tables; do
  for parent in DOCKER-USER INPUT; do
    chain=SURVEY_INGRESS
    [ "$parent" = INPUT ] && chain=SURVEY_HOST
    if [ "$mode" = --remove ]; then
      if "$ipt" -w -C "$parent" -i "$iface" -j "$chain" 2>/dev/null; then
        "$ipt" -w -D "$parent" -i "$iface" -j "$chain"
      fi
      "$ipt" -w -F "$chain" 2>/dev/null || true
      "$ipt" -w -X "$chain" 2>/dev/null || true
      continue
    fi
    "$ipt" -w -N "$chain" 2>/dev/null || true
    "$ipt" -w -F "$chain"
    "$ipt" -w -A "$chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
    for port in 8000 8095 5432 6543; do
      # Forwarded packets are already DNATed: match their original host port.
      if [ "$parent" = DOCKER-USER ]; then
        set -- -p tcp -m conntrack --ctstate DNAT --ctorigdstport "$port"
      else
        set -- -p tcp --dport "$port"
      fi
      if [ "$ipt" = iptables ] && { [ "$port" = 8000 ] || [ "$port" = 8095 ]; }; then
        "$ipt" -w -A "$chain" "$@" -s "$frontend" -j RETURN
      fi
      "$ipt" -w -A "$chain" "$@" -j DROP
    done
    "$ipt" -w -A "$chain" -j RETURN
    "$ipt" -w -C "$parent" -i "$iface" -j "$chain" 2>/dev/null || "$ipt" -w -I "$parent" 1 -i "$iface" -j "$chain"
  done
done
