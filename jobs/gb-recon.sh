#!/usr/bin/env bash
# gb-recon: bounded reachability probe — can the 1win mirror demo gate
# launch two penalty-shootout titles from this runner's egress?
# Loads each play page logged-out, clicks ONLY the demo gate control,
# records frames/net/screenshots into out/gb for artifact upload.
set -uo pipefail
mkdir -p out/gb && cd out/gb
curl -sL -o chs.zip https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.38/linux64/chrome-headless-shell-linux64.zip
unzip -q chs.zip
cp ../../jobs/gb/cdp.js ../../jobs/gb/gb-recon.js .
export BW_CHROME="$PWD/chrome-headless-shell-linux64/chrome-headless-shell"
node -v; "$BW_CHROME" --version || true
curl -s https://www.cloudflare.com/cdn-cgi/trace | grep -E '^(ip|loc)=' || true
run() { local tag=$1 url=$2 port=$3; BW_PORT=$port BW_PROFILE=/tmp/gb-prof-$tag GB_OUT="$PWD" GB_TAG="$tag" GB_URL="$url" node gb-recon.js > "$tag.log" 2>&1 || true; }
run evo-gha "https://one-vv7890.com/en/casino/play/v_evoplay:one_win_penalty_shoot_out" 9631
run pen-gha "https://one-vv7890.com/en/casino/play/v_1wingames:penalty" 9632
ls -la; ls -la shots || true
