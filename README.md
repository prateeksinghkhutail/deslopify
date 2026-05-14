# deslopify

Automatic context bloat management for AI developer CLIs. Stop paying for bloated contexts. Stop losing your AI's memory.

**deslopify** monitors your AI CLI sessions (Claude Code, OpenCode) and automatically compacts the context when it gets too large -- preserving a structured summary of everything that happened.

## The Problem

When using AI CLIs like Claude Code or OpenCode, the context window fills up fast. Once it's bloated:
- Costs skyrocket (you're paying for tokens the AI can barely use)
- The AI becomes sluggish and starts "forgetting" earlier decisions
- You lose architectural context from earlier in the session

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                  deslopify daemon                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Claude Code hooks ──┐                                  │
│  OpenCode plugin ────┼──▶ Context Monitor               │
│  FS watcher (fb) ────┘         │                        │
│                          threshold hit?                  │
│                                │                        │
│                         ┌──────▼──────┐                 │
│                         │  Wait Idle  │                 │
│                         └──────┬──────┘                 │
│                                │                        │
│                    ┌───────────▼───────────┐            │
│                    │  Compaction Pipeline  │            │
│                    │  1. Get transcript    │            │
│                    │  2. Summarize via CLI │            │
│                    │  3. Write memory file │            │
│                    │  4. Execute /compact  │            │
│                    │  5. Inject summary    │            │
│                    └──────────────────────┘            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

1. **Monitor**: Hooks into Claude Code's lifecycle events and OpenCode's plugin system to track token usage
2. **Detect**: When context hits 40% of max (configurable), triggers compaction
3. **Wait**: Waits for the CLI to be idle (no active tool calls or streaming)
4. **Summarize**: Uses the same CLI to generate a structured summary (zero extra API keys)
5. **Save**: Writes the summary to `project-memory.md` (write-ahead -- saved BEFORE compact)
6. **Compact**: Executes the native `/compact` command
7. **Restore**: Injects the summary as the first message in the fresh context

## Installation

```bash
npm install -g deslopify
```

## Quick Start

```bash
# 1. Install hooks for your CLI(s)
deslopify install claude-code
deslopify install opencode

# 2. Start the daemon
deslopify start

# 3. Use your AI CLI as normal -- deslopify handles the rest
claude  # or opencode
```

That's it. deslopify runs in the background, monitors your sessions, and automatically manages context.

## Commands

| Command | Description |
|---------|-------------|
| `deslopify start` | Start the background daemon |
| `deslopify start -f` | Run in foreground (see live events) |
| `deslopify stop` | Stop the daemon |
| `deslopify status` | Show daemon status and active sessions |
| `deslopify install <cli>` | Install hooks (claude-code, opencode) |
| `deslopify uninstall <cli>` | Remove hooks |
| `deslopify compact [id]` | Manually trigger compaction |
| `deslopify config` | Show current configuration |
| `deslopify init` | Create a config file in current directory |

## Configuration

Create a `deslopify.config.json` in your project root or `~/.deslopify/config.json` globally:

```json
{
  "threshold": 0.4,
  "memoryFile": "project-memory.md",
  "pollInterval": 5000,
  "adapters": ["claude-code", "opencode"],
  "summarization": {
    "provider": "same-cli",
    "maxSummaryTokens": 2000
  },
  "injection": {
    "method": "first-message",
    "maxInjectTokens": 1500
  },
  "idle": {
    "waitMs": 3000,
    "maxWaitMs": 30000
  }
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `threshold` | `0.4` | Context usage percentage to trigger compaction (0.0-1.0) |
| `memoryFile` | `"project-memory.md"` | File name for saved summaries |
| `pollInterval` | `5000` | How often to check sessions (ms) |
| `adapters` | `["claude-code", "opencode"]` | Which CLIs to monitor |
| `summarization.provider` | `"same-cli"` | What generates summaries |
| `summarization.maxSummaryTokens` | `2000` | Max tokens for summary |
| `injection.method` | `"first-message"` | How to restore context post-compact |
| `injection.maxInjectTokens` | `1500` | Max tokens for injected summary |
| `idle.waitMs` | `3000` | How long session must be idle before compacting |
| `idle.maxWaitMs` | `30000` | Max time to wait for idle state |

## How Integration Works

### Claude Code

deslopify registers hooks in `~/.claude/settings.json`:
- **PostToolUse**: Fires after every tool call, notifies daemon to check context
- **PostCompact**: Fires after `/compact` completes, signals context is fresh

Token usage is read directly from session transcripts at `~/.claude/projects/<path>/<session>.jsonl`.

### OpenCode

deslopify installs as a plugin that sends events to the daemon:
- Monitors messages and tool completions
- Reads token counts from OpenCode's SQLite database at `~/.local/share/opencode/opencode.db`

## The Memory File

After compaction, your `project-memory.md` looks like this:

```markdown
# Project Memory

> Auto-generated by deslopify - Context management for AI CLIs.

---

## Session Checkpoint - 2025-01-15T14:30:00.000Z

> Model: `claude-sonnet-4-20250514` | Tokens at compaction: 82.4k | Session: `a3f2b1c4...`

### Architectural Decisions
- Using PostgreSQL for the database layer
- Event sourcing pattern for audit trail
- React Server Components for the frontend

### Completed Tasks
- Set up project scaffolding with Next.js 15
- Implemented user authentication with OAuth2
- Created database migration system

### Open Issues
- Rate limiting not yet implemented
- Need to add error boundaries to React components

### Current Goals
- Implement the payment processing module
- Add integration tests for auth flow

---
```

## Safety Guarantees

- **Write-ahead**: Memory is saved to disk BEFORE compact executes. If compact fails, your memory is preserved.
- **Idle detection**: Never interrupts active operations. Waits for the CLI to finish its current task.
- **Non-destructive**: deslopify never modifies your code or session files directly.
- **Graceful degradation**: If summarization fails, a minimal fallback summary is saved.
- **Clean uninstall**: `deslopify uninstall` removes all hooks cleanly.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DESLOPIFY_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` |

## Architecture

```
src/
├── config/          # Configuration loading and validation
├── daemon/          # IPC server and process management
├── adapters/        # CLI-specific integrations
│   ├── claude-code  # Reads JSONL transcripts, hooks system
│   ├── opencode     # Reads SQLite, plugin system
│   └── filesystem   # Universal fallback (file watching)
├── monitor/         # Context tracking and idle detection
├── pipeline/        # Summarization, memory writing, compaction
└── utils/           # Logging, token counting, path resolution
```

## Supported CLIs

| CLI | Status | Integration Method |
|-----|--------|-------------------|
| Claude Code | Supported | Native hooks (PostToolUse, PostCompact) |
| OpenCode | Supported | Plugin system + SQLite monitoring |
| Codex CLI | Planned (v2) | Pending native compact support |

## Development

```bash
git clone https://github.com/deslopify/deslopify
cd deslopify
npm install
npm run build
npm run dev  # Watch mode

# Run in foreground for development
node dist/bin/deslopify.js start -f
```

## License

MIT
