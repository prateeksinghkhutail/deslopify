import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";
import type { BaseAdapter, TranscriptMessage } from "./base.js";
import type { SessionInfo, AdapterType, DeslopifyConfig } from "../config/loader.js";
import { getModelMaxTokens } from "../config/loader.js";
import {
  getClaudeCodeHome,
  getClaudeCodeSessionsDir,
  getClaudeCodeProjectsDir,
  getClaudeCodeSettingsPath,
  encodeProjectPath,
  getDeslopifyHome,
} from "../utils/paths.js";
import { logger } from "../utils/logger.js";

interface ClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version: string;
  kind: string;
  status: string;
  updatedAt?: number;
}

interface ClaudeMessage {
  type: string;
  message?: any;
  content?: string;
  subtype?: string;
}

export class ClaudeCodeAdapter implements BaseAdapter {
  readonly name: AdapterType = "claude-code";
  private config: DeslopifyConfig;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which claude", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  async getActiveSessions(): Promise<SessionInfo[]> {
    const sessionsDir = getClaudeCodeSessionsDir();
    if (!fs.existsSync(sessionsDir)) return [];

    const sessions: SessionInfo[] = [];
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const filePath = path.join(sessionsDir, file);
        const raw = fs.readFileSync(filePath, "utf-8");
        const session: ClaudeSession = JSON.parse(raw);

        // Check if the process is still running
        if (!this.isProcessRunning(session.pid)) {
          // Clean up stale session file
          try {
            fs.unlinkSync(filePath);
          } catch {}
          continue;
        }

        const usage = await this.getTokenUsage(session.sessionId);
        const model = usage?.model || "claude-sonnet-4-20250514";
        const tokensUsed = usage?.used || 0;
        const maxTokens = getModelMaxTokens(model, this.config);

        sessions.push({
          id: session.sessionId,
          cli: "claude-code",
          projectPath: session.cwd,
          model,
          tokensUsed,
          maxTokens,
          percentUsed: maxTokens > 0 ? tokensUsed / maxTokens : 0,
          status: session.status === "idle" ? "idle" : "active",
          lastActivity: session.updatedAt || session.startedAt,
        });
      } catch (err) {
        logger.debug(`Failed to parse session file ${file}`, {
          error: String(err),
        });
      }
    }

    return sessions;
  }

  async getTokenUsage(
    sessionId: string
  ): Promise<{ used: number; model: string } | null> {
    const transcriptPath = this.findTranscriptFile(sessionId);
    if (!transcriptPath) return null;

    try {
      const content = fs.readFileSync(transcriptPath, "utf-8");
      const lines = content.trim().split("\n");

      let lastTokenCount = 0;
      let model = "claude-sonnet-4-20250514";

      // Read from the end to find the most recent assistant message with usage
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry: ClaudeMessage = JSON.parse(lines[i]);
          if (entry.type === "assistant" && entry.message) {
            if (entry.message.usage) {
              const usage = entry.message.usage;
              lastTokenCount =
                (usage.input_tokens || 0) +
                (usage.output_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.cache_read_input_tokens || 0);
            }
            if (entry.message.model) {
              model = entry.message.model;
            }
            break;
          }
        } catch {
          continue;
        }
      }

      return { used: lastTokenCount, model };
    } catch {
      return null;
    }
  }

  async isIdle(sessionId: string): Promise<boolean> {
    const sessionsDir = getClaudeCodeSessionsDir();
    if (!fs.existsSync(sessionsDir)) return false;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
        const session: ClaudeSession = JSON.parse(raw);
        if (session.sessionId === sessionId) {
          return session.status === "idle";
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  async getTranscript(sessionId: string): Promise<string> {
    const transcriptPath = this.findTranscriptFile(sessionId);
    if (!transcriptPath) return "";

    const content = fs.readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n");
    const messages: string[] = [];

    for (const line of lines) {
      try {
        const entry: ClaudeMessage = JSON.parse(line);
        if (entry.type === "user" && entry.message) {
          const text =
            typeof entry.message === "string"
              ? entry.message
              : entry.message.content || JSON.stringify(entry.message);
          messages.push(`USER: ${text}`);
        } else if (entry.type === "assistant" && entry.message) {
          const content = entry.message.content;
          if (Array.isArray(content)) {
            const text = content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n");
            if (text) messages.push(`ASSISTANT: ${text}`);
          }
        }
      } catch {
        continue;
      }
    }

    // Return last N messages to keep summarization prompt manageable
    const recentMessages = messages.slice(-50);
    return recentMessages.join("\n\n---\n\n");
  }

  async compact(sessionId: string): Promise<boolean> {
    try {
      // Send /compact to the running Claude Code session
      // Claude Code listens for commands via its session management
      // We use the hook system - PostCompact will fire when done
      const result = spawn("claude", ["--session", sessionId, "--compact"], {
        stdio: "pipe",
        timeout: 60000,
      });

      return new Promise((resolve) => {
        result.on("close", (code) => {
          resolve(code === 0);
        });
        result.on("error", () => {
          resolve(false);
        });
        // Timeout fallback
        setTimeout(() => resolve(false), 60000);
      });
    } catch (err) {
      logger.error("Failed to compact Claude Code session", {
        sessionId,
        error: String(err),
      });
      return false;
    }
  }

  async injectMessage(sessionId: string, message: string): Promise<boolean> {
    try {
      // Use claude CLI to send a message to the session
      const result = spawn(
        "claude",
        ["--session", sessionId, "--print", message],
        {
          stdio: "pipe",
          timeout: 30000,
        }
      );

      return new Promise((resolve) => {
        result.on("close", (code) => resolve(code === 0));
        result.on("error", () => resolve(false));
        setTimeout(() => resolve(false), 30000);
      });
    } catch {
      return false;
    }
  }

  async getProjectPath(sessionId: string): Promise<string | null> {
    const sessionsDir = getClaudeCodeSessionsDir();
    if (!fs.existsSync(sessionsDir)) return null;

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
        const session: ClaudeSession = JSON.parse(raw);
        if (session.sessionId === sessionId) {
          return session.cwd;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  async install(): Promise<void> {
    const settingsPath = getClaudeCodeSettingsPath();
    let settings: any = {};

    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    // Ensure hooks object exists
    if (!settings.hooks) settings.hooks = {};

    // Create the hook script
    const hookDir = path.join(getDeslopifyHome(), "hooks");
    fs.mkdirSync(hookDir, { recursive: true });

    const hookScript = path.join(hookDir, "claude-post-tool.sh");
    const hookContent = `#!/bin/bash
# deslopify: notify daemon after each tool use
SOCKET="${path.join(getDeslopifyHome(), "daemon.sock")}"
if [ -S "$SOCKET" ]; then
  echo '{"event":"tool_complete","cli":"claude-code","sessionId":"'$CLAUDE_SESSION_ID'"}' | nc -U "$SOCKET" 2>/dev/null || true
fi
`;
    fs.writeFileSync(hookScript, hookContent, { mode: 0o755 });

    // Register PostToolUse hook
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

    const existingHook = settings.hooks.PostToolUse.find(
      (h: any) =>
        h.hooks &&
        h.hooks.some((hh: any) => hh.command && hh.command.includes("deslopify"))
    );

    if (!existingHook) {
      settings.hooks.PostToolUse.push({
        matcher: "",
        hooks: [
          {
            type: "command",
            command: hookScript,
            timeout: 5000,
          },
        ],
      });
    }

    // Register PostCompact hook
    if (!settings.hooks.PostCompact) settings.hooks.PostCompact = [];

    const existingCompactHook = settings.hooks.PostCompact.find(
      (h: any) =>
        h.hooks &&
        h.hooks.some((hh: any) => hh.command && hh.command.includes("deslopify"))
    );

    if (!existingCompactHook) {
      const compactHookScript = path.join(hookDir, "claude-post-compact.sh");
      const compactHookContent = `#!/bin/bash
# deslopify: notify daemon after compact completes
SOCKET="${path.join(getDeslopifyHome(), "daemon.sock")}"
if [ -S "$SOCKET" ]; then
  echo '{"event":"compact_complete","cli":"claude-code","sessionId":"'$CLAUDE_SESSION_ID'"}' | nc -U "$SOCKET" 2>/dev/null || true
fi
`;
      fs.writeFileSync(compactHookScript, compactHookContent, { mode: 0o755 });

      settings.hooks.PostCompact.push({
        matcher: "",
        hooks: [
          {
            type: "command",
            command: compactHookScript,
            timeout: 5000,
          },
        ],
      });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    logger.info("Claude Code hooks installed successfully");
  }

  async uninstall(): Promise<void> {
    const settingsPath = getClaudeCodeSettingsPath();
    if (!fs.existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

      // Remove deslopify hooks
      if (settings.hooks) {
        for (const event of Object.keys(settings.hooks)) {
          settings.hooks[event] = settings.hooks[event].filter(
            (h: any) =>
              !h.hooks ||
              !h.hooks.some(
                (hh: any) => hh.command && hh.command.includes("deslopify")
              )
          );
          if (settings.hooks[event].length === 0) {
            delete settings.hooks[event];
          }
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      logger.info("Claude Code hooks removed");
    } catch (err) {
      logger.error("Failed to uninstall Claude Code hooks", {
        error: String(err),
      });
    }
  }

  private findTranscriptFile(sessionId: string): string | null {
    const projectsDir = getClaudeCodeProjectsDir();
    if (!fs.existsSync(projectsDir)) return null;

    // Search all project directories for the session file
    const projectDirs = fs.readdirSync(projectsDir);
    for (const dir of projectDirs) {
      const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
