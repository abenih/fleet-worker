#!/usr/bin/env bash
# fleet-bootstrap.sh — idempotent bootstrap for the fleet-worker codespace.
#
# Invoked on every codespace start via .devcontainer/devcontainer.json
# (postStartCommand), with output appended to ~/fleet-bootstrap.log.
#
# Jobs:
#   1. ensure openssh-server is installed
#   2. host keys + unlock the codespace account for pubkey auth
#   3. ensure Muse's public key is in ~/.ssh/authorized_keys
#   4. ensure a tunnel keypair exists (~/.ssh/tunnel_key)
#   5. publish the tunnel PUBLIC key to the repo branch `fleet-bootstrap`
#      (file tunnel-pubkey.txt) so Muse can authorize it on the VPS
#   6. run sshd on port 2222
#   7. run a persistent reverse-tunnel loop to the SpotGames VPS
#      (127.0.0.1:2224 on the VPS -> 127.0.0.1:2222 here). The loop retries
#      forever; it only succeeds once the key from step 5 is authorized.
#
# Deliberately no `set -e`: each step logs and continues past failures.
# State lives in ~/fleet-bootstrap/ (pidfiles, tunnel log, done marker).

set -u

STATE_DIR="$HOME/fleet-bootstrap"
mkdir -p "$STATE_DIR"

say() { echo "[bootstrap $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

CLAUDE_KEY_BODY="AAAAC3NzaC1lZDI1NTE5AAAAIDsUj7fHzISxbPncdrBA4VYPgCSKh/PMa/K4tePQ6cpo"
CLAUDE_KEY_LINE="ssh-ed25519 $CLAUDE_KEY_BODY hatch"
VPS_TARGET="root@89.105.213.91"

say "=== fleet bootstrap starting (user=$(whoami), host=$(hostname)) ==="

# --- 1. openssh-server -------------------------------------------------------
if [ -x /usr/sbin/sshd ]; then
  say "openssh-server already installed"
else
  say "installing openssh-server"
  sudo apt-get update -qq && sudo apt-get install -y -qq openssh-server \
    || say "WARN: apt-get install openssh-server failed (continuing)"
fi

# --- 2. host keys + account --------------------------------------------------
sudo ssh-keygen -A >/dev/null 2>&1 || say "WARN: ssh-keygen -A failed"
sudo mkdir -p /run/sshd || say "WARN: mkdir /run/sshd failed"
sudo usermod -p '*' codespace 2>/dev/null || say "WARN: usermod -p failed"

# --- 3. Muse's authorized key ----------------------------------------------
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys" && chmod 600 "$HOME/.ssh/authorized_keys"
if grep -q "$CLAUDE_KEY_BODY" "$HOME/.ssh/authorized_keys"; then
  say "Muse key already in authorized_keys"
else
  echo "$CLAUDE_KEY_LINE" >> "$HOME/.ssh/authorized_keys"
  say "Muse key added to authorized_keys"
fi

# --- 4. tunnel keypair ---------------------------------------------------------
if [ -f "$HOME/.ssh/tunnel_key" ]; then
  say "tunnel keypair already exists"
else
  ssh-keygen -t ed25519 -N '' -f "$HOME/.ssh/tunnel_key" >/dev/null 2>&1 \
    || say "WARN: tunnel keypair generation failed"
  say "tunnel keypair generated"
fi

# --- 5. publish the tunnel public key via git ---------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say "repo root: $REPO_ROOT"
if [ -f "$HOME/.ssh/tunnel_key.pub" ] && cd "$REPO_ROOT"; then
  cp "$HOME/.ssh/tunnel_key.pub" "$REPO_ROOT/tunnel-pubkey.txt"
  git config user.name  >/dev/null 2>&1 || git config user.name  "fleet-worker codespace"
  git config user.email >/dev/null 2>&1 || git config user.email "fleet-worker@users.noreply.github.com"
  if git checkout -B fleet-bootstrap >>"$HOME/fleet-bootstrap.log" 2>&1; then
    git add tunnel-pubkey.txt
    if git diff --cached --quiet; then
      say "tunnel pubkey unchanged on branch fleet-bootstrap"
    else
      git commit -m "fleet bootstrap: tunnel pubkey" >>"$HOME/fleet-bootstrap.log" 2>&1 \
        || say "WARN: git commit of tunnel pubkey failed"
    fi
    PUSH_OUT="$(git push origin fleet-bootstrap 2>&1)" && say "pushed branch fleet-bootstrap" || {
      say "first push failed, retrying once: $PUSH_OUT"
      sleep 3
      PUSH_OUT="$(git push origin fleet-bootstrap 2>&1)" && say "pushed branch fleet-bootstrap (retry)" || {
        say "ERROR: git push failed: $PUSH_OUT"
        {
          echo "fleet bootstrap push failure $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          echo "$PUSH_OUT"
        } > "$REPO_ROOT/bootstrap-status.txt"
        git add bootstrap-status.txt 2>/dev/null
        git commit -m "fleet bootstrap: push failure status" >>"$HOME/fleet-bootstrap.log" 2>&1
        git push origin fleet-bootstrap >>"$HOME/fleet-bootstrap.log" 2>&1 \
          || say "ERROR: status push also failed"
      }
    }
  else
    say "WARN: git checkout -B fleet-bootstrap failed"
  fi
else
  say "WARN: tunnel pubkey or repo root missing; skipping publish step"
fi

# --- 6. sshd on port 2222 -------------------------------------------------------
if ss -tlnp 2>/dev/null | grep -q ':2222[[:space:]]'; then
  say "sshd already listening on 2222"
else
  sudo /usr/sbin/sshd -o Port=2222 -o PasswordAuthentication=no \
    && say "sshd started on port 2222" \
    || say "WARN: sshd failed to start"
fi

# --- 7. reverse tunnel loop ------------------------------------------------------
TUNNEL_PIDFILE="$STATE_DIR/tunnel.pid"
if [ -f "$TUNNEL_PIDFILE" ] && kill -0 "$(cat "$TUNNEL_PIDFILE")" 2>/dev/null; then
  say "tunnel loop already running (pid $(cat "$TUNNEL_PIDFILE"))"
else
  nohup bash -c 'while true; do ssh -N -i "$HOME/.ssh/tunnel_key" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 127.0.0.1:2224:127.0.0.1:2222 '"$VPS_TARGET"'; sleep 5; done' > "$STATE_DIR/tunnel.log" 2>&1 &
  echo $! > "$TUNNEL_PIDFILE"
  say "tunnel loop started (pid $!)"
fi

touch "$STATE_DIR/bootstrap-done"
say "=== fleet bootstrap finished ==="
