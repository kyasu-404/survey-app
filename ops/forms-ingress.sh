#!/bin/sh
# Production STSS. Update only the rules owned by this application.
set -eu

mode=${1:-apply}
case "$mode" in
  apply|--remove) ;;
  *) echo "Usage: $0 [apply|--remove]" >&2; exit 2 ;;
esac

interfaces=${SURVEY_INGRESS_INTERFACES:-${SURVEY_INGRESS_INTERFACE:-}}
frontend_ipv4=${SURVEY_FRONTEND_IP:-192.168.6.99}
frontend_ipv6=${SURVEY_FRONTEND_IPV6:-}
# Disable pathname expansion on administrator-supplied interface lists.
set -f
for iface in $interfaces; do
  case "$iface" in
    lo|*[!a-zA-Z0-9_.:-]*) echo "Invalid ingress interface: $iface" >&2; exit 2 ;;
  esac
done
for frontend in "$frontend_ipv4" "$frontend_ipv6"; do
  case "$frontend" in
    *[!0-9a-fA-F.:]*) echo "Expected a literal frontend IP address" >&2; exit 2 ;;
  esac
done

exec 9>"${SURVEY_INGRESS_LOCK_FILE:-/run/lock/survey-forms-ingress.lock}"
flock -x 9
work=$(mktemp -d)
trap 'rm -f -- "$work/iptables" "$work/ip6tables"; rmdir -- "$work"' EXIT
trap 'exit 1' HUP INT TERM

render() {
  rules=$1
  frontend=$2
  printf '%s\n' '*filter'
  if [ "$mode" != --remove ]; then
    printf '%s\n' ':SURVEY_HOST - [0:0]'
    if printf '%s\n' "$rules" | awk '$1 == "-N" && $2 == "DOCKER-USER" {found=1} END {exit !found}'; then
      printf '%s\n' ':SURVEY_INGRESS - [0:0]'
    fi
  fi
  for parent in INPUT DOCKER-USER; do
    case "$parent" in
      INPUT) chain=SURVEY_HOST ;;
      DOCKER-USER) chain=SURVEY_INGRESS ;;
    esac
    if ! printf '%s\n' "$rules" | awk -v parent="$parent" '$1 == "-P" || $1 == "-N" {if ($2 == parent) found=1} END {exit !found}'; then
      continue
    fi
    # Replace previous jumps, including the legacy one-interface configuration.
    printf '%s\n' "$rules" | awk -v parent="$parent" -v chain="$chain" \
      '$1 == "-A" && $2 == parent && $(NF-1) == "-j" && $NF == chain {sub(/^-A /, "-D "); print}'
    if [ "$mode" = --remove ]; then
      if printf '%s\n' "$rules" | awk -v chain="$chain" '$1 == "-N" && $2 == chain {found=1} END {exit !found}'; then
        printf '%s\n' "-F $chain" "-X $chain"
      fi
      continue
    fi

    printf '%s\n' "-A $chain -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
    for port in 8000 8443 8095 5432 6543; do
      case "$parent" in
        INPUT) match="-p tcp --dport $port" ;;
        DOCKER-USER) match="-p tcp -m conntrack --ctstate DNAT --ctorigdstport $port" ;;
      esac
      case "$port" in
        8000|8443|8095)
          if [ -n "$frontend" ]; then
            printf '%s\n' "-A $chain $match -s $frontend -j RETURN"
          fi
          ;;
      esac
      printf '%s\n' "-A $chain $match -j DROP"
    done
    if [ -n "$interfaces" ]; then
      for iface in $interfaces; do
        printf '%s\n' "-I $parent 1 -i $iface -j $chain"
      done
    else
      printf '%s\n' "-I $parent 1 ! -i lo -j $chain"
    fi
  done
  printf '%s\n' COMMIT
}

for ipt in iptables ip6tables; do
  # On hosts with IPv6 disabled at the kernel, there is no IPv6 traffic to filter.
  if [ "$ipt" = ip6tables ] && [ ! -e /proc/sys/net/ipv6/conf/all/disable_ipv6 ]; then
    continue
  fi
  if ! rules=$("$ipt" -w -S); then
    if [ "$ipt" = ip6tables ] && [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6)" = 1 ]; then
      continue
    fi
    exit 1
  fi
  frontend=$frontend_ipv4
  [ "$ipt" = iptables ] || frontend=$frontend_ipv6
  render "$rules" "$frontend" > "$work/$ipt"
  "$ipt-restore" -w --noflush --test < "$work/$ipt"
done

# Each family commits in a single transaction. Validate both before applying either.
for ipt in iptables ip6tables; do
  [ ! -f "$work/$ipt" ] || "$ipt-restore" -w --noflush < "$work/$ipt"
done
