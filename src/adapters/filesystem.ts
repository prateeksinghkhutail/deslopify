import * as fs from "node:fs";
import * as path from "node:path";
import { watch } from "chokidar";
import type { BaseAdapter } from "./base.js";
import type { SessionInfo, AdapterType, DeslopifyConfig } from "../config/loader.js";
import { getModelMaxTokens } from "../config/loader.js";
import {
  getClaudeCodeProjectsDir,
  getOpenCodeDbPath,
} from "../utils/paths.js";
import { estimateTokens } from "../utils/tokens.js";
import { logger } from "../utils/logger.js";

/**
 * Filesystem-based adapter that watches session files for changes.
 * This is the universal fallback when hooks/plugins aren't available.
 */
export class FilesystemAdapter implements BaseAdapter {
  readonly name: AdapterType = "claude-code"; // Used as fallback for either
  private config: DeslopifyConfig;
  private watcher: any = null;
  private onChange: ((sessionId: string, cli: AdapterType) => void) | null = null;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    // FS adapter is always available as a fallback
    return true;
  }

  /**
   * Start watching session directories for changes
   */
  startWatching(callback: (sessionId: string, cli: AdapterType) => void): void {
    this.onChange = callback;
    const watchPaths: string[] = [];

    // Watch Claude Code transcripts
    const claudeProjectsDir = getClaudeCodeProjectsDir();
    if (fs.existsSync(claudeProjectsDir)) {
      watchPaths.push(path.join(claudeProjectsDir, "**", "*.jsonl"));
    }

    // Watch OpenCode database
    const openCodeDb = getOpenCodeDbPath();
    if (fs.existsSync(openCodeDb)) {
      watchPaths.push(openCodeDb);
    }

    if (watchPaths.length === 0) {
      logger.warn("No session directories found to watch");
      return;
    }

    this.watcher = watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 500,
      },
    });

    this.watcher.on("change", (filePath: string) => {
      this.handleFileChange(filePath);
    });

    this.watcher.on("add", (filePath: string) => {
      this.handleFileChange(filePath);
    });

    logger.info("Filesystem watcher started", { paths: watchPaths });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private handleFileChange(filePath: string): void {
    if (!this.onChange) return;

    if (filePath.endsWith(".jsonl") && filePath.includes(".claude")) {
      // Claude Code transcript changed
      const sessionId = path.basename(filePath, ".jsonl");
      this.onChange(sessionId, "claude-code");
    } else if (filePath.includes("opencode.db")) {
      // OpenCode database changed - we'd need to query it to find the active session
      this.onChange("latest", "opencode");
    }
  }

  // These methods delegate to the appropriate CLI-specific adapter
  // The FS adapter is primarily a trigger mechanism

  async getActiveSessions(): Promise<SessionInfo[]> {
    // Scan Claude Code session files
    const sessions: SessionInfo[] = [];
    const claudeProjectsDir = getClaudeCodeProjectsDir();

    if (fs.existsSync(claudeProjectsDir)) {
      const projectDirs = fs.readdirSync(claudeProjectsDir);
      for (const dir of projectDirs) {
        const dirPath = path.join(claudeProjectsDir, dir);
        if (!fs.statSync(dirPath).isDirectory()) continue;

        const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
        for (const file of jsonlFiles) {
          const filePath = path.join(dirPath, file);
          const stat = fs.statSync(filePath);

          // Only consider recently modified files (last 30 minutes)
          if (Date.now() - stat.mtimeMs > 30 * 60 * 1000) continue;

          const sessionId = path.basename(file, ".jsonl");
          const fileSize = stat.size;
          const estimatedTokens = Math.round(fileSize / 4); // Rough estimate

          sessions.push({
            id: sessionId,
            cli: "claude-code",
            projectPath: dir.replace(/-/g, "/"),
            model: "claude-sonnet-4-20250514",
            tokensUsed: estimatedTokens,
            maxTokens: 200000,
            percentUsed: estimatedTokens / 200000,
            status: "unknown",
            lastActivity: stat.mtimeMs,
          });
        }
      }
    }

    return sessions;
  }

  async getTokenUsage(
    sessionId: string
  ): Promise<{ used: number; model: string } | null> {
    // Delegate to file-based estimation
    const claudeProjectsDir = getClaudeCodeProjectsDir();
    if (!fs.existsSync(claudeProjectsDir)) return null;

    const projectDirs = fs.readdirSync(claudeProjectsDir);
    for (const dir of projectDirs) {
      const filePath = path.join(claudeProjectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const tokens = estimateTokens(content);
        return { used: tokens, model: "claude-sonnet-4-20250514" };
      }
    }
    return null;
  }

  async isIdle(_sessionId: string): Promise<boolean> {
    // Without process-level insight, use file modification time as proxy
    return true;
  }

  async getTranscript(sessionId: string): Promise<string> {
    const claudeProjectsDir = getClaudeCodeProjectsDir();
    if (!fs.existsSync(claudeProjectsDir)) return "";

    const projectDirs = fs.readdirSync(claudeProjectsDir);
    for (const dir of projectDirs) {
      const filePath = path.join(claudeProjectsDir, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    }
    return "";
  }

  async compact(_sessionId: string): Promise<boolean> {
    return false; // FS adapter can't directly compact
  }

  async injectMessage(_sessionId: string, _message: string): Promise<boolean> {
    return false; // FS adapter can't inject
  }

  async getProjectPath(_sessionId: string): Promise<string | null> {
    return process.cwd();
  }

  async install(): Promise<void> {
    logger.info("Filesystem adapter requires no installation");
  }

  async uninstall(): Promise<void> {
    this.stopWatching();
  }
}
