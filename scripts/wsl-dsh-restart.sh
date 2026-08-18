#!/usr/bin/env bash
# Restart the DSH web instance running inside this WSL distribution so it picks
# up the freshly built plugin. Works for both manager-launched instances (with
# the windows-lifecycle bridge patch) and plain manual instances:
#
#   1. locate the process serving PORT and capture its exact launch command/cwd
#   2. stop it — prefer the authenticated Runtime Bridge shutdown (TCP 6290,
#      token read from the manager's per-launch patch); fall back to SIGTERM
#   3. relaunch the captured command detached, then verify port + HTTP
#
# The DeepSeek Harness Manager re-adopts the relaunched process through its WSL
# detection (same --patch keeps the same bridge token). The Manager Control pipe
# is NOT used: its start/stop/restart always target the default Windows instance.
#
# Usage (from Windows PowerShell, after `npm run build`):
#   wsl.exe -d Ubuntu-24.04 -- bash /mnt/c/dsh-network-settings/scripts/wsl-dsh-restart.sh
#
# Overridable via environment:
#   PORT       web port (default 3092)
#   BRIDGE_PORT lifecycle bridge TCP port (default 6290)
#   DSH_LOG    log file for the relaunched process (default ~/.dsh/dsh-web.log)
#   PATCH_GLOB where to find the manager's windows-lifecycle.patch.yml files
set -u

PORT="${PORT:-3092}"
BRIDGE_PORT="${BRIDGE_PORT:-6290}"
DSH_LOG="${DSH_LOG:-$HOME/.dsh/dsh-web.log}"
PATCH_GLOB="${PATCH_GLOB:-/mnt/c/Users/kanneiren/AppData/Local/DeepSeekHarnessManager/runtime/wsl-detected-Ubuntu-24.04-*/windows-lifecycle.patch.yml}"

# --- 1. locate the current instance -----------------------------------------
PID=$(ss -ltnp 2>/dev/null | grep ":$PORT " | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -n1)
if [ -z "$PID" ]; then
  PID=$(pgrep -f "dsh.*--port $PORT" | head -n1)
fi

LAUNCH_CMD=""
LAUNCH_CWD="$HOME"
if [ -n "$PID" ]; then
  LAUNCH_CMD=$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null | sed 's/ $//')
  LAUNCH_CWD=$(readlink "/proc/$PID/cwd" 2>/dev/null || echo "$HOME")
  echo "current pid: $PID"
  echo "launch cmd : $LAUNCH_CMD"
  echo "cwd        : $LAUNCH_CWD"
  # The DeepSeek Harness Manager deletes its per-launch --patch file when the
  # instance stops. A captured --patch reference that no longer resolves must
  # be stripped, otherwise the relaunch fails with ENOENT during boot.
  if printf '%s' "$LAUNCH_CMD" | grep -q -- '--patch'; then
    PATCH_ARG=$(printf '%s' "$LAUNCH_CMD" | sed -n 's/.*--patch \([^ ]*\).*/\1/p')
    if [ -n "$PATCH_ARG" ] && [ ! -f "$PATCH_ARG" ]; then
      echo "manager patch file gone ($PATCH_ARG); relaunching without --patch"
      LAUNCH_CMD=$(printf '%s' "$LAUNCH_CMD" | sed 's/ --patch [^ ]*//')
    fi
  fi
else
  echo "no DSH process on port $PORT; starting fresh"
  LAUNCH_CMD="node $HOME/.npm-global/bin/dsh --profile web --port $PORT"
fi

# --- 2. bridge helpers -------------------------------------------------------
bridge_request() { # $1 = request type (getStatus/shutdown), $2 = token
  python3 - "$1" "$2" "$BRIDGE_PORT" <<'PY'
import socket, sys, json
req_type, token, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
msg = {
    "protocolVersion": 1,
    "messageType": "command",
    "requestId": "dsh-network-settings-restart",
    "type": req_type,
    "token": token,
}
try:
    s = socket.create_connection(("127.0.0.1", port), timeout=3)
    s.sendall((json.dumps(msg) + "\n").encode())
    s.settimeout(6)
    data = s.recv(65536)
    s.close()
    line = data.decode(errors="replace").splitlines()[0]
    resp = json.loads(line)
    print("ok" if resp.get("ok") else "fail")
except Exception as exc:
    print("fail:" + str(exc))
PY
}

# --- 3. stop the instance ----------------------------------------------------
if [ -n "$PID" ]; then
  SHUTDOWN_DONE=0
  for patch in $PATCH_GLOB; do
    [ -f "$patch" ] || continue
    TOKEN=$(sed -n "s/.*token:[[:space:]]*'\([0-9a-f]*\)'.*/\1/p" "$patch" | head -n1)
    [ -n "$TOKEN" ] || continue
    STATUS=$(bridge_request getStatus "$TOKEN")
    if [ "$STATUS" = "ok" ]; then
      echo "bridge reachable with token from $(basename "$(dirname "$patch")")"
      RESULT=$(bridge_request shutdown "$TOKEN")
      if [ "$RESULT" = "ok" ]; then
        echo "bridge shutdown accepted"
        SHUTDOWN_DONE=1
      fi
      break
    fi
  done
  if [ "$SHUTDOWN_DONE" -eq 0 ]; then
    echo "bridge shutdown unavailable; sending SIGTERM"
    kill "$PID" 2>/dev/null
  fi
  for _ in $(seq 1 40); do
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "still alive, sending SIGKILL"
    kill -9 "$PID"
    sleep 1
  fi
  echo "old process exited"
fi

# --- 4. relaunch the exact same command --------------------------------------
cd "$LAUNCH_CWD" || cd "$HOME" || exit 1
nohup $LAUNCH_CMD >> "$DSH_LOG" 2>&1 &
NEW=$!
echo "launched pid: $NEW"

# --- 5. verify ----------------------------------------------------------------
READY=0
for _ in $(seq 1 60); do
  if ss -ltn 2>/dev/null | grep -q ":$PORT "; then READY=1; break; fi
  sleep 0.5
done
echo "listening: $([ "$READY" -eq 1 ] && echo yes || echo no)"
if [ "$READY" -eq 1 ]; then
  curl -s -o /dev/null -w 'http_code=%{http_code}\n' --max-time 8 "http://127.0.0.1:$PORT/" || echo 'curl failed'
fi
echo "=== proc ==="
ps -eo pid,ppid,lstart,args | grep -E "dsh.*--port $PORT" | grep -v grep
echo "=== log tail ==="
tail -n 8 "$DSH_LOG"
