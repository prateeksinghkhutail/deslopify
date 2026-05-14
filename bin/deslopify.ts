#!/usr/bin/env node

import { Command } from "commander";
import { loadConfig } from "../src/config/loader.js";
import { startDaemon, stopDaemon, getDaemonStatus } from "../src/daemon/process.js";
import { DeslopifyDaemon } from "../src/daemon/server.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { OpenCodeAdapter } from "../src/adapters/opencode.js";
import { ContextTracker } from "../src/monitor/context-tracker.js";
import { formatTokens } from "../src/utils/tokens.js";
import { logger } from "../src/utils/logger.js";
import type { AdapterType } from "../src/config/loader.js";

const program = new Command();

program
  .name("deslopify")
  .description(
    "Automatic context bloat management for AI developer CLIs (Claude Code, OpenCode)"
  )
  .version("1.0.0");

// ─── START ───────────────────────────────────────────────────────────────────

program
  .command("start")
  .description("Start the deslopify daemon (background process)")
  .option("-f, --foreground", "Run in foreground (don't daemonize)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (opts) => {
    const config = loadConfig(opts.config);

    if (opts.foreground) {
      console.log("Starting deslopify in foreground mode...");
      console.log(`  Threshold: ${config.threshold * 100}%`);
      console.log(`  Adapters: ${config.adapters.join(", ")}`);
      console.log(`  Poll interval: ${config.pollInterval}ms`);
      console.log(`  Memory file: ${config.memoryFile}`);
      console.log("");

      const daemon = new DeslopifyDaemon(config);

      daemon.on("compaction_start", (session) => {
        console.log(
          `\n[COMPACTING] Session ${session.id.slice(0, 8)}... ` +
            `(${(session.percentUsed * 100).toFixed(1)}% used)`
        );
      });

      daemon.on("compaction_complete", (session) => {
        console.log(
          `[DONE] Session ${session.id.slice(0, 8)}... compacted successfully\n`
        );
      });

      daemon.on("compaction_error", (session, err) => {
        console.error(
          `[ERROR] Compaction failed for ${session.id.slice(0, 8)}...: ${err}\n`
        );
      });

      process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await daemon.stop();
        process.exit(0);
      });

      process.on("SIGTERM", async () => {
        await daemon.stop();
        process.exit(0);
      });

      await daemon.start();
      console.log("Daemon running. Press Ctrl+C to stop.\n");
    } else {
      console.log("Starting deslopify daemon...");
      const status = await startDaemon();

      if (status.running) {
        console.log(`Daemon started (PID: ${status.pid})`);
        console.log(`Socket: ${status.socketPath}`);
      } else {
        console.error("Failed to start daemon");
        process.exit(1);
      }
    }
  });

// ─── STOP ────────────────────────────────────────────────────────────────────

program
  .command("stop")
  .description("Stop the deslopify daemon")
  .action(async () => {
    const stopped = await stopDaemon();
    if (stopped) {
      console.log("Daemon stopped.");
    } else {
      console.log("Daemon was not running.");
    }
  });

// ─── STATUS ──────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show daemon status and monitored sessions")
  .option("-c, --config <path>", "Path to config file")
  .action(async (opts) => {
    const config = loadConfig(opts.config);
    const daemonStatus = await getDaemonStatus();

    console.log("Deslopify Status");
    console.log("================");
    console.log(
      `  Daemon: ${daemonStatus.running ? "RUNNING" : "STOPPED"}${daemonStatus.pid ? ` (PID: ${daemonStatus.pid})` : ""}`
    );

    if (daemonStatus.uptime) {
      const uptimeMin = Math.round(daemonStatus.uptime / 1000 / 60);
      console.log(`  Uptime: ${uptimeMin} minutes`);
    }

    console.log(`  Threshold: ${config.threshold * 100}%`);
    console.log(`  Memory file: ${config.memoryFile}`);
    console.log("");

    // Show active sessions
    console.log("Active Sessions:");
    console.log("────────────────");

    for (const adapterName of config.adapters) {
      const adapter =
        adapterName === "claude-code"
          ? new ClaudeCodeAdapter(config)
          : new OpenCodeAdapter(config);

      if (!(await adapter.isAvailable())) {
        console.log(`  ${adapterName}: not installed`);
        continue;
      }

      const sessions = await adapter.getActiveSessions();
      if (sessions.length === 0) {
        console.log(`  ${adapterName}: no active sessions`);
        continue;
      }

      for (const session of sessions) {
        const pct = (session.percentUsed * 100).toFixed(1);
        const bar = renderProgressBar(session.percentUsed, config.threshold);
        const tokens = formatTokens(session.tokensUsed);
        const maxTokens = formatTokens(session.maxTokens);

        console.log(
          `  [${session.cli}] ${session.id.slice(0, 8)}... ${bar} ${pct}% (${tokens}/${maxTokens})`
        );
        console.log(
          `    Model: ${session.model} | Project: ${session.projectPath}`
        );
      }
    }
  });

// ─── INSTALL ─────────────────────────────────────────────────────────────────

program
  .command("install")
  .description("Install hooks/plugins for a CLI")
  .argument("<cli>", "CLI to install for (claude-code, opencode)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (cli: string, opts) => {
    const config = loadConfig(opts.config);

    if (!["claude-code", "opencode"].includes(cli)) {
      console.error(`Unknown CLI: ${cli}. Supported: claude-code, opencode`);
      process.exit(1);
    }

    const adapter =
      cli === "claude-code"
        ? new ClaudeCodeAdapter(config)
        : new OpenCodeAdapter(config);

    if (!(await adapter.isAvailable())) {
      console.error(`${cli} is not installed or not available`);
      process.exit(1);
    }

    console.log(`Installing deslopify hooks for ${cli}...`);
    await adapter.install();
    console.log(`Done! ${cli} integration installed.`);
    console.log(`\nNext steps:`);
    console.log(`  1. Run: deslopify start`);
    console.log(`  2. Use ${cli} as normal - deslopify will monitor automatically`);
  });

// ─── UNINSTALL ───────────────────────────────────────────────────────────────

program
  .command("uninstall")
  .description("Remove hooks/plugins for a CLI")
  .argument("<cli>", "CLI to uninstall from (claude-code, opencode)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (cli: string, opts) => {
    const config = loadConfig(opts.config);

    if (!["claude-code", "opencode"].includes(cli)) {
      console.error(`Unknown CLI: ${cli}. Supported: claude-code, opencode`);
      process.exit(1);
    }

    const adapter =
      cli === "claude-code"
        ? new ClaudeCodeAdapter(config)
        : new OpenCodeAdapter(config);

    console.log(`Removing deslopify hooks for ${cli}...`);
    await adapter.uninstall();
    console.log("Done! Hooks removed.");
  });

// ─── COMPACT (manual trigger) ────────────────────────────────────────────────

program
  .command("compact")
  .description("Manually trigger compaction for a session")
  .argument("[session-id]", "Session ID to compact (auto-detects if omitted)")
  .option("--cli <cli>", "CLI type (claude-code, opencode)", "claude-code")
  .option("-c, --config <path>", "Path to config file")
  .action(async (sessionId: string | undefined, opts) => {
    const config = loadConfig(opts.config);
    const cli = opts.cli as AdapterType;

    const adapter =
      cli === "claude-code"
        ? new ClaudeCodeAdapter(config)
        : new OpenCodeAdapter(config);

    if (!(await adapter.isAvailable())) {
      console.error(`${cli} is not available`);
      process.exit(1);
    }

    // Auto-detect session if not provided
    if (!sessionId) {
      const sessions = await adapter.getActiveSessions();
      if (sessions.length === 0) {
        console.error("No active sessions found");
        process.exit(1);
      }
      // Pick the most active session
      const sorted = sessions.sort((a, b) => b.percentUsed - a.percentUsed);
      sessionId = sorted[0].id;
      console.log(
        `Auto-selected session ${sessionId.slice(0, 8)}... (${(sorted[0].percentUsed * 100).toFixed(1)}% used)`
      );
    }

    console.log(`Triggering compaction for session ${sessionId.slice(0, 8)}...`);

    // Run the full pipeline
    const { CompactionPipeline } = await import("../src/pipeline/compactor.js");
    const pipeline = new CompactionPipeline(config);
    const sessions = await adapter.getActiveSessions();
    const session = sessions.find((s) => s.id === sessionId);

    if (!session) {
      console.error(`Session ${sessionId} not found`);
      process.exit(1);
    }

    try {
      await pipeline.execute(session, adapter);
      console.log("Compaction complete!");
    } catch (err) {
      console.error(`Compaction failed: ${err}`);
      process.exit(1);
    }
  });

// ─── CONFIG ──────────────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show current configuration")
  .option("-c, --config <path>", "Path to config file")
  .action((opts) => {
    const config = loadConfig(opts.config);
    console.log(JSON.stringify(config, null, 2));
  });

// ─── INIT ────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Create a deslopify.config.json in the current directory")
  .action(() => {
    const fs = require("node:fs");
    const configPath = "deslopify.config.json";

    if (fs.existsSync(configPath)) {
      console.error(`${configPath} already exists`);
      process.exit(1);
    }

    const defaultConfig = {
      threshold: 0.4,
      memoryFile: "project-memory.md",
      pollInterval: 5000,
      adapters: ["claude-code", "opencode"],
      summarization: {
        provider: "same-cli",
        maxSummaryTokens: 2000,
      },
      injection: {
        method: "first-message",
        maxInjectTokens: 1500,
      },
      idle: {
        waitMs: 3000,
        maxWaitMs: 30000,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`Created ${configPath}`);
    console.log("Edit this file to customize your deslopify settings.");
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderProgressBar(percent: number, threshold: number): string {
  const width = 20;
  const filled = Math.round(percent * width);
  const thresholdPos = Math.round(threshold * width);

  let bar = "";
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      bar += i >= thresholdPos ? "!" : "=";
    } else if (i === thresholdPos) {
      bar += "|";
    } else {
      bar += " ";
    }
  }
  return `[${bar}]`;
}

// Parse and execute
program.parse();
