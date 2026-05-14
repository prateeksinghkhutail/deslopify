#!/bin/bash
# deslopify: Claude Code PostCompact hook
# Notifies the deslopify daemon that compaction completed

DESLOPIFY_HOME="${HOME}/.deslopify"
SOCKET="${DESLOPIFY_HOME}/daemon.sock"

if [ -S "$SOCKET" ]; then
  SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
  echo "{\"event\":\"compact_complete\",\"cli\":\"claude-code\",\"sessionId\":\"${SESSION_ID}\"}" \
    | nc -U "$SOCKET" 2>/dev/null || true
fi

exit 0
