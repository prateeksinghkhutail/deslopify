import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawn } from "node:child_process";
import type { BaseAdapter } from "./base.js";
import type { SessionInfo, AdapterType, DeslopifyConfig } from "../config/loader.js";
import { getModelMaxTokens } from "../config/loader.js";
import { getOpenCodeDbPath, getDeslopifyHome } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

interface OpenCodeSession {
  id: string;
  project_id: string;
  title: string;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  time_compacting: string | null;
  time_archived: string | null;
  model: string;
  agent: string;
}

export class OpenCodeAdapter implements BaseAdapter {
  readonly name: AdapterType = "opencode";
  private config: DeslopifyConfig;
  private db: any = null;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    try {
      execSync("which opencode", { stdio: "pipe", timeout: 5000 });
      return fs.existsSync(getOpenCodeDbPath());
    } catch {
      return false;
    }
  }

  private async getDb(): Promise<any> {
    if (this.db) return this.db;

    const dbPath = getOpenCodeDbPath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`OpenCode database not found at ${dbPath}`);
    }

    try {
      const initSqlJs = (await import("sql.js")).default;
      const SQL = await initSqlJs();
      const buffer = fs.readFileSync(dbPath);
      this.db = new SQL.Database(buffer);
      return this.db;
    } catch (err) {
      logger.error("Failed to open OpenCode database", { error: String(err) });
      throw err;
    }
  }

  private runQuery(db: any, sql: string, params?: any[]): any[] {
    const stmt = db.prepare(sql);
    if (params) stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async getActiveSessions(): Promise<SessionInfo[]> {
    try {
      const db = await this.getDb();
      const sessions = this.runQuery(
        db,
        `SELECT * FROM session 
         WHERE time_archived IS NULL 
         ORDER BY rowid DESC 
         LIMIT 10`
      ) as OpenCodeSession[];

      return sessions.map((s) => {
        const tokensUsed =
          (s.tokens_input || 0) +
          (s.tokens_output || 0) +
          (s.tokens_cache_read || 0) +
          (s.tokens_cache_write || 0);
        const modelStr = s.model || "claude-sonnet-4-20250514";
        const maxTokens = getModelMaxTokens(modelStr, this.config);

        return {
          id: s.id,
          cli: "opencode" as AdapterType,
          projectPath: this.resolveProjectPath(s.project_id),
          model: parseModelId(modelStr),
          tokensUsed,
          maxTokens,
          percentUsed: maxTokens > 0 ? tokensUsed / maxTokens : 0,
          status: s.time_compacting ? "compacting" : "active",
          lastActivity: Date.now(), // OpenCode doesn't expose last activity time easily
        } as SessionInfo;
      });
    } catch (err) {
      logger.error("Failed to get OpenCode sessions", { error: String(err) });
      return [];
    }
  }

  async getTokenUsage(
    sessionId: string
  ): Promise<{ used: number; model: string } | null> {
    try {
      const db = await this.getDb();
      const results = this.runQuery(
        db,
        `SELECT * FROM session WHERE id = ?`,
        [sessionId]
      ) as OpenCodeSession[];

      const session = results[0];
      if (!session) return null;

      const tokensUsed =
        (session.tokens_input || 0) +
        (session.tokens_output || 0) +
        (session.tokens_cache_read || 0) +
        (session.tokens_cache_write || 0);

      return { used: tokensUsed, model: session.model || "unknown" };
    } catch {
      return null;
    }
  }

  async isIdle(sessionId: string): Promise<boolean> {
    // OpenCode doesn't have a direct "status" field like Claude Code
    // We check if there's been no new messages in the last few seconds
    try {
      const db = await this.getDb();
      const results1 = this.runQuery(
        db,
        `SELECT rowid FROM message 
         WHERE session_id = ? 
         ORDER BY rowid DESC LIMIT 1`,
        [sessionId]
      );

      // Wait a moment and check again
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Re-read the DB file for fresh data
      this.db = null;
      const db2 = await this.getDb();
      const results2 = this.runQuery(
        db2,
        `SELECT rowid FROM message 
         WHERE session_id = ? 
         ORDER BY rowid DESC LIMIT 1`,
        [sessionId]
      );

      const lastMessage = results1[0];
      const newLastMessage = results2[0];

      // If rowid hasn't changed, session is likely idle
      return (
        !lastMessage ||
        !newLastMessage ||
        lastMessage.rowid === newLastMessage.rowid
      );
    } catch {
      return true; // Assume idle on error
    }
  }

  async getTranscript(sessionId: string): Promise<string> {
    try {
      const db = await this.getDb();
      const messages = this.runQuery(
        db,
        `SELECT data FROM message 
         WHERE session_id = ? 
         ORDER BY rowid ASC`,
        [sessionId]
      ) as { data: string }[];

      const transcript: string[] = [];

      for (const msg of messages) {
        try {
          const data = JSON.parse(msg.data);
          const role = data.role || "unknown";
          const content =
            typeof data.content === "string"
              ? data.content
              : Array.isArray(data.content)
              ? data.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("\n")
              : JSON.stringify(data.content);

          if (content) {
            transcript.push(`${role.toUpperCase()}: ${content}`);
          }
        } catch {
          continue;
        }
      }

      // Return last N messages
      return transcript.slice(-50).join("\n\n---\n\n");
    } catch (err) {
      logger.error("Failed to get OpenCode transcript", {
        error: String(err),
      });
      return "";
    }
  }

  async compact(sessionId: string): Promise<boolean> {
    try {
      // OpenCode supports /compact - send it via the CLI
      const result = spawn("opencode", ["compact", "--session", sessionId], {
        stdio: "pipe",
        timeout: 60000,
      });

      return new Promise((resolve) => {
        result.on("close", (code) => resolve(code === 0));
        result.on("error", () => {
          // Fallback: try via export + new session approach
          resolve(false);
        });
        setTimeout(() => resolve(false), 60000);
      });
    } catch (err) {
      logger.error("Failed to compact OpenCode session", {
        sessionId,
        error: String(err),
      });
      return false;
    }
  }

  async injectMessage(sessionId: string, message: string): Promise<boolean> {
    try {
      // For OpenCode, inject via the plugin system or by sending a message
      const result = spawn(
        "opencode",
        ["send", "--session", sessionId, message],
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
    try {
      const db = await this.getDb();
      const results = this.runQuery(
        db,
        `SELECT project_id FROM session WHERE id = ?`,
        [sessionId]
      ) as { project_id: string }[];

      const session = results[0];
      if (!session) return null;
      return this.resolveProjectPath(session.project_id);
    } catch {
      return null;
    }
  }

  async install(): Promise<void> {
    // Create an OpenCode plugin that notifies the deslopify daemon
    const pluginDir = path.join(getDeslopifyHome(), "plugins", "opencode");
    fs.mkdirSync(pluginDir, { recursive: true });

    const pluginPackageJson = {
      name: "deslopify-opencode-plugin",
      version: "1.0.0",
      main: "index.js",
      type: "module",
    };

    fs.writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify(pluginPackageJson, null, 2)
    );

    const pluginCode = `
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';

const SOCKET_PATH = path.join(os.homedir(), '.deslopify', 'daemon.sock');

function notifyDaemon(event, sessionId) {
  try {
    const client = net.createConnection(SOCKET_PATH);
    client.write(JSON.stringify({ event, cli: 'opencode', sessionId }));
    client.end();
  } catch {}
}

export function onMessage(message) {
  if (message.role === 'assistant') {
    notifyDaemon('message_complete', message.sessionId);
  }
}

export function onToolComplete(tool) {
  notifyDaemon('tool_complete', tool.sessionId);
}
`;

    fs.writeFileSync(path.join(pluginDir, "index.js"), pluginCode);

    logger.info(`OpenCode plugin files written to ${pluginDir}`);
    logger.info(
      "To complete installation, add the plugin path to your OpenCode config:\n" +
        `  Plugin directory: ${pluginDir}`
    );
  }

  async uninstall(): Promise<void> {
    const pluginDir = path.join(getDeslopifyHome(), "plugins", "opencode");
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true });
      logger.info("OpenCode plugin removed");
    }
  }

  private resolveProjectPath(projectId: string): string {
    // OpenCode project_id might be the path or an encoded form
    if (fs.existsSync(projectId)) return projectId;
    return process.cwd();
  }
}

/**
 * Parse model ID from OpenCode's JSON model format or plain string
 */
function parseModelId(model: string): string {
  try {
    const parsed = JSON.parse(model);
    if (parsed && typeof parsed === "object" && parsed.id) {
      return parsed.id;
    }
  } catch {
    // Not JSON
  }
  return model;
}
