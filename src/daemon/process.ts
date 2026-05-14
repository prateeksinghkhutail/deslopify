import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { fork, spawn } from "node:child_process";
import {
  getSocketPath,
  getPidFilePath,
  getDeslopifyHome,
  ensureDir,
} from "../utils/paths.js";
import { logger } from "../utils/logger.js";

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  uptime: number | null;
  socketPath: string;
}

/**
 * Resolve the path to the dist directory (where compiled JS lives)
 */
function getDistDir(): string {
  // This file is at dist/daemon/process.js at runtime
  // Walk up to find the package root by looking for package.json
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return path.join(dir, "dist");
    }
    dir = path.dirname(dir);
  }
  // Fallback: assume we're in dist/daemon/
  return path.resolve(__dirname, "..");
}

/**
 * Start the deslopify daemon as a background process
 */
export async function startDaemon(): Promise<DaemonStatus> {
  const existing = await getDaemonStatus();
  if (existing.running) {
    logger.info("Daemon is already running", { pid: existing.pid });
    return existing;
  }

  ensureDir(getDeslopifyHome());

  const pidFile = getPidFilePath();
  const distDir = getDistDir();

  // Write a runner script that the daemon will use
  const runnerPath = path.join(getDeslopifyHome(), "daemon-runner.mjs");
  const serverPath = path.join(distDir, "src", "daemon", "server.js");
  const configPath = path.join(distDir, "src", "config", "loader.js");

  const runnerContent = `
import { DeslopifyDaemon } from '${serverPath}';
import { loadConfig } from '${configPath}';
import * as fs from 'node:fs';

const config = loadConfig();
const daemon = new DeslopifyDaemon(config);

// Write PID
fs.writeFileSync('${pidFile}', String(process.pid));

// Handle shutdown
process.on('SIGTERM', async () => {
  await daemon.stop();
  try { fs.unlinkSync('${pidFile}'); } catch {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  await daemon.stop();
  try { fs.unlinkSync('${pidFile}'); } catch {}
  process.exit(0);
});

await daemon.start();
console.log('Deslopify daemon running (PID: ' + process.pid + ')');
`;

  fs.writeFileSync(runnerPath, runnerContent);

  // Fork as a detached background process
  const child = fork(runnerPath, [], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  // Wait for socket to appear (daemon is ready)
  const socketPath = getSocketPath();
  let attempts = 0;
  while (attempts < 20) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (fs.existsSync(socketPath)) break;
    attempts++;
  }

  return getDaemonStatus();
}

/**
 * Stop the running daemon
 */
export async function stopDaemon(): Promise<boolean> {
  const status = await getDaemonStatus();
  if (!status.running || !status.pid) {
    logger.info("Daemon is not running");
    return false;
  }

  try {
    process.kill(status.pid, "SIGTERM");

    // Wait for process to exit
    let attempts = 0;
    while (attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      try {
        process.kill(status.pid, 0);
        attempts++;
      } catch {
        break; // Process is gone
      }
    }

    // Clean up PID file
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    // Clean up socket
    const socketPath = getSocketPath();
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }

    logger.info("Daemon stopped");
    return true;
  } catch (err) {
    logger.error("Failed to stop daemon", { error: String(err) });
    return false;
  }
}

/**
 * Get the current daemon status
 */
export async function getDaemonStatus(): Promise<DaemonStatus> {
  const pidFile = getPidFilePath();
  const socketPath = getSocketPath();

  const result: DaemonStatus = {
    running: false,
    pid: null,
    uptime: null,
    socketPath,
  };

  if (!fs.existsSync(pidFile)) return result;

  try {
    const pidStr = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) return result;

    // Check if process is alive
    try {
      process.kill(pid, 0);
      result.running = true;
      result.pid = pid;

      // Calculate uptime from PID file mtime
      const stat = fs.statSync(pidFile);
      result.uptime = Date.now() - stat.mtimeMs;
    } catch {
      // Process is dead, clean up stale files
      try {
        fs.unlinkSync(pidFile);
      } catch {}
      try {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
      } catch {}
    }
  } catch {
    // Can't read PID file
  }

  return result;
}

/**
 * Send a message to the running daemon
 */
export function sendToDaemon(message: object): Promise<boolean> {
  return new Promise((resolve) => {
    const socketPath = getSocketPath();
    if (!fs.existsSync(socketPath)) {
      resolve(false);
      return;
    }

    const client = net.createConnection(socketPath);
    client.on("connect", () => {
      client.write(JSON.stringify(message));
      client.end();
      resolve(true);
    });
    client.on("error", () => resolve(false));
    setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 5000);
  });
}
