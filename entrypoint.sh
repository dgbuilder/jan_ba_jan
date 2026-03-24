#!/bin/bash
set -e

HOSTNAME="ssh.aiaihoplava.xyz"
LOCAL_PORT=2222

# Start cloudflared tunnel in background
cloudflared access ssh --hostname "$HOSTNAME" --listener "localhost:$LOCAL_PORT" &
TUNNEL_PID=$!
echo "🚇 Cloudflared tunnel started (PID: $TUNNEL_PID) on localhost:$LOCAL_PORT"
sleep 2

# Override SSH_HOST/SSH_PORT for the bot
export SSH_HOST=localhost
export SSH_PORT=$LOCAL_PORT

# Start bot in foreground
exec node index.js
