# Clauditor Desktop

## What This Is

A port of the [IyadhKhalfallah/clauditor](https://github.com/IyadhKhalfallah/clauditor) quota/session manager to the **Claude Code Desktop App** — the standalone native GUI for Claude Code on Mac/Windows. The existing Clauditor was built for and tested against the CLI and IDE extensions; this project explicitly adds Desktop App support with enhanced auto-compacting behavior (trigger at 40% context window), platform-aware disabling (Claude AI Desktop App ≠ Claude Code Desktop App), and context preservation across session rotations.

## Core Value

Auto-compact Claude Code Desktop App sessions at 40% context fill, save a high-fidelity summary, and inject it on restart — so users never lose work to context overflow regardless of whether they're in CLI, JetBrains, or Desktop App.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Hook into Claude Code Desktop App via the same 7-hook mechanism as the CLI version
- [ ] Detect runtime: enable auto-compact for CLI + JetBrains + Desktop App, disable for Claude AI Desktop App (non-Code)
- [ ] Trigger auto-compact at 40% context window usage (not waste-factor threshold)
- [ ] Save summary using structured handoff template (TASK, COMPLETED, IN_PROGRESS, FAILED_APPROACHES, DECISIONS)
- [ ] Mechanical extraction from JSONL transcripts (files modified, commits, commands)
- [ ] Inject saved context at next SessionStart
- [ ] Config at `~/.clauditor/config.json` (compatible with existing format + new `threshold_percent` field)
- [ ] Desktop App notification on session rotation

### Out of Scope

- RTK integration — use RTK directly, not embedded
- Caveman integration — use Caveman directly, not embedded
- GSD workflow integration — out of scope
- claude.ai/code web version — explicitly excluded (no local JSONL)
- Team Hub / shared error patterns — deferred
- PreToolUse error injection — Phase 2 (nice-to-have)

## Context

**Based on**: `IyadhKhalfallah/clauditor` (MIT). Key mechanism: 7 Claude Code hooks + JSONL transcript parsing + session state at `~/.clauditor/sessions/<encoded-project-path>/<timestamp>.md`.

**Platform gap**: Original Clauditor explicitly tested for CLI + VS Code + JetBrains. Claude Code Desktop App is a native GUI wrapper around the same `claude` binary — it should write JSONL to `~/.claude/projects/` the same way, but hook behavior in Desktop App context needs validation.

**Platform detection challenge**: Must distinguish:
- Claude Code CLI / IDE / Desktop App → auto-compact enabled
- Claude AI Desktop App (general assistant) → auto-compact disabled
Detection approach: check `CLAUDE_CODE_*` env vars, presence of project JSONL, or `--dangerously-skip-permissions` flag patterns.

**40% threshold rationale**: User specified 40% (vs original waste-factor-based rotation). Earlier trigger = smaller summaries = better handoff quality = fewer lost tokens per rotation.

**Existing config format**: `rotation.enabled`, `rotation.threshold` (tokens/turn), `rotation.minTurns`. Will add `rotation.contextPercent: 40` and `platforms.desktopApp: true`.

## Constraints

- **Compatibility**: Must not break existing CLI + JetBrains behavior from original Clauditor
- **Language**: Follow original repo's language/tooling (Node.js hooks + shell scripts)
- **Config**: Backward-compatible config format — new fields are additive only
- **JSONL dependency**: Desktop App must write JSONL files at expected paths; if not, graceful fallback

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork IyadhKhalfallah/clauditor | Reuse proven hook architecture vs build from scratch | — Pending |
| 40% context threshold | User requirement; earlier = better handoff quality | — Pending |
| Platform detection via env vars | Most reliable cross-platform approach in hook shell scripts | — Pending |
| No RTK/Caveman/GSD integration | User confirmed: use those tools directly, don't bundle | ✓ Good |

---
*Last updated: 2026-05-08 after initialization*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
