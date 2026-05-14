#!/bin/bash
# deslopify: Claude Code PostToolUse hook
# Notifies the deslopify daemon that a tool call completed
# This script is installed by 'deslopify install claude-code'

DESLOPIFY_HOME="${HOME}/.deslopify"
SOCKET="${DESLOPIFY_HOME}/daemon.sock"

# Only notify if daemon is running (socket exists)
if [ -S "$SOCKET" ]; then
  # Get session ID from environment (Claude Code sets this)
  SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
  
  # Send event to daemon via unix socket
  echo "{\"event\":\"tool_complete\",\"cli\":\"claude-code\",\"sessionId\":\"${SESSION_ID}\"}" \
    | nc -U "$SOCKET" 2>/dev/null || true
fi

exit 0
