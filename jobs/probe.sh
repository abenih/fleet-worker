#!/usr/bin/env bash
# Fleet probe: runner specs, egress identity, and demo-host reachability (status only).
set -u

echo "== fleet probe =="
date -u

echo "--- specs ---"
nproc
free -m
df -h /

echo "--- runtimes ---"
node --version 2>/dev/null || echo "node: not found"
python3 --version 2>/dev/null || echo "python3: not found"

echo "--- egress ---"
curl -s --max-time 15 https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|loc)=' || echo "trace failed"

echo "--- demo hosts (status only) ---"
status() {
  label="$1"; url="$2"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo "ERR")
  echo "$label -> HTTP $code"
}
status "pragmatic-openGame-vs20sugarrush" "https://demogamesfree.meiiwmlwqo.net/gs2c/openGame.do?gameSymbol=vs20sugarrush&lang=en&lobbyUrl=https://one-vv7890.com/casino&stylename=1win&strategy=iframe"
status "spribe-plinko" "https://demo.spribe.io/launch/plinko"
status "one-vv7890" "https://one-vv7890.com"

echo "PROBE DONE"
