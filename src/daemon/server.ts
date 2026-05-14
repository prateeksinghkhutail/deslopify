import * as net from "node:net";
import * as fs from "node:fs";
import { EventEmitter } from "node:events";
import type { DeslopifyConfig, AdapterType, SessionInfo } from "../config/loader.js";
import { getSocketPath, ensureDir, getDeslopifyHome } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { ContextTracker } from "../monitor/context-tracker.js";
import { IdleDetector } from "../monitor/idle-detector.js";
import { CompactionPipeline } from "../pipeline/compactor.js";
import { ClaudeCodeAdapter } from "../adapters/claude-code.js";
import { OpenCodeAdapter } from "../adapters/opencode.js";
import { FilesystemAdapter } from "../adapters/filesystem.js";
import type { BaseAdapter } from "../adapters/base.js";

interface DaemonEvent {
  event: string;
  cli: AdapterType;
  sessionId: string;
}

export class DeslopifyDaemon extends EventEmitter {
  private server: net.Server | null = null;
  private config: DeslopifyConfig;
  private adapters: Map<AdapterType, BaseAdapter> = new Map();
  private contextTracker: ContextTracker;
  private idleDetector: IdleDetector;
  private pipeline: CompactionPipeline;
  private fsAdapter: FilesystemAdapter;
  private pollInterval: NodeJS.Timeout | null = null;
  private compactingSessionIds: Set<string> = new Set();

  constructor(config: DeslopifyConfig) {
    super();
    this.config = config;
    this.contextTracker = new ContextTracker(config);
    this.idleDetector = new IdleDetector(config);
    this.pipeline = new CompactionPipeline(config);
    this.fsAdapter = new FilesystemAdapter(config);

    // Initialize adapters
    if (config.adapters.includes("claude-code")) {
      this.adapters.set("claude-code", new ClaudeCodeAdapter(config));
    }
    if (config.adapters.includes("opencode")) {
      this.adapters.set("opencode", new OpenCodeAdapter(config));
    }
  }

  async start(): Promise<void> {
    ensureDir(getDeslopifyHome());
    const socketPath = getSocketPath();

    // Clean up stale socket
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {}
    }

    // Start IPC server
    this.server = net.createServer((connection) => {
      connection.on("data", (data) => {
        this.handleMessage(data.toString());
      });
      connection.on("error", () => {}); // Ignore client errors
    });

    this.server.listen(socketPath, () => {
      logger.info(`Daemon listening on ${socketPath}`);
    });

    this.server.on("error", (err) => {
      logger.error("Daemon server error", { error: String(err) });
    });

    // Start filesystem watcher as fallback
    this.fsAdapter.startWatching((sessionId, cli) => {
      this.handleMessage(
        JSON.stringify({ event: "file_change", cli, sessionId })
      );
    });

    // Start polling interval for periodic checks
    this.pollInterval = setInterval(() => {
      this.pollSessions();
    }, this.config.pollInterval);

    // Initial poll
    await this.pollSessions();

    logger.info("Deslopify daemon started", {
      adapters: Array.from(this.adapters.keys()),
      threshold: this.config.threshold,
      pollInterval: this.config.pollInterval,
    });
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.fsAdapter.stopWatching();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    const socketPath = getSocketPath();
    if (fs.existsSync(socketPath)) {
      try {
        fs.unlinkSync(socketPath);
      } catch {}
    }

    logger.info("Deslopify daemon stopped");
  }

  private handleMessage(raw: string): void {
    try {
      const event: DaemonEvent = JSON.parse(raw.trim());
      logger.debug("Received event", event);

      switch (event.event) {
        case "tool_complete":
        case "message_complete":
        case "file_change":
          this.checkSession(event.sessionId, event.cli);
          break;
        case "compact_complete":
          this.onCompactComplete(event.sessionId, event.cli);
          break;
        default:
          logger.debug(`Unknown event: ${event.event}`);
      }
    } catch (err) {
      logger.debug("Failed to parse daemon message", { raw, error: String(err) });
    }
  }

  private async pollSessions(): Promise<void> {
    for (const [cli, adapter] of this.adapters) {
      try {
        const sessions = await adapter.getActiveSessions();
        for (const session of sessions) {
          if (this.compactingSessionIds.has(session.id)) continue;
          await this.evaluateSession(session, adapter);
        }
      } catch (err) {
        logger.debug(`Poll error for ${cli}`, { error: String(err) });
      }
    }
  }

  private async checkSession(sessionId: string, cli: AdapterType): Promise<void> {
    if (this.compactingSessionIds.has(sessionId)) return;

    const adapter = this.adapters.get(cli);
    if (!adapter) return;

    const usage = await adapter.getTokenUsage(sessionId);
    if (!usage) return;

    const sessions = await adapter.getActiveSessions();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    await this.evaluateSession(session, adapter);
  }

  private async evaluateSession(
    session: SessionInfo,
    adapter: BaseAdapter
  ): Promise<void> {
    const { percentUsed, id } = session;

    if (percentUsed >= this.config.threshold) {
      logger.info(
        `Session ${id} hit threshold: ${(percentUsed * 100).toFixed(1)}% >= ${this.config.threshold * 100}%`
      );

      // Wait for idle
      const isIdle = await this.idleDetector.waitForIdle(id, adapter);
      if (!isIdle) {
        logger.warn(`Session ${id} did not become idle, skipping compaction`);
        return;
      }

      // Trigger compaction pipeline
      this.compactingSessionIds.add(id);
      this.emit("compaction_start", session);

      try {
        await this.pipeline.execute(session, adapter);
        this.emit("compaction_complete", session);
      } catch (err) {
        logger.error(`Compaction failed for session ${id}`, {
          error: String(err),
        });
        this.emit("compaction_error", session, err);
      } finally {
        this.compactingSessionIds.delete(id);
      }
    }
  }

  private onCompactComplete(sessionId: string, _cli: AdapterType): void {
    logger.info(`Compact completed for session ${sessionId}`);
    this.compactingSessionIds.delete(sessionId);
  }

  getStatus(): {
    running: boolean;
    adapters: string[];
    monitoredSessions: number;
    compactingSessions: string[];
  } {
    return {
      running: this.server !== null,
      adapters: Array.from(this.adapters.keys()),
      monitoredSessions: this.adapters.size,
      compactingSessions: Array.from(this.compactingSessionIds),
    };
  }
}
