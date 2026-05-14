import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  fork: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/utils/paths.js", () => ({
  getSocketPath: vi.fn(() => "/tmp/test.sock"),
  getPidFilePath: vi.fn(() => "/tmp/test.pid"),
  getDeslopifyHome: vi.fn(() => "/tmp/.deslopify"),
  getDefaultConfigPath: vi.fn(() => "/tmp/.deslopify/config.json"),
  getClaudeCodeHome: vi.fn(() => "/tmp/.claude"),
  getClaudeCodeSettingsPath: vi.fn(() => "/tmp/.claude/settings.json"),
  getClaudeCodeSessionsDir: vi.fn(() => "/tmp/.claude/sessions"),
  getClaudeCodeProjectsDir: vi.fn(() => "/tmp/.claude/projects"),
  getOpenCodeDbPath: vi.fn(() => "/tmp/opencode.db"),
  getOpenCodeStorageDir: vi.fn(() => "/tmp/opencode"),
  getMemoryFilePath: vi.fn(
    (p: string, f: string) => `${p}/${f}`
  ),
  getProjectRoot: vi.fn(() => null),
  ensureDir: vi.fn(),
  encodeProjectPath: vi.fn((p: string) => p.replace(/\//g, "-")),
}));

vi.mock("../../../src/utils/tokens.js", () => ({
  countTokens: vi.fn(() => 1000),
  estimateTokens: vi.fn(() => 1000),
  calculateUsagePercent: vi.fn(() => 0.5),
  formatTokens: vi.fn((n: number) => `${(n / 1000).toFixed(1)}k`),
}));

import * as fs from "node:fs";
import {
  getDaemonStatus,
  stopDaemon,
  sendToDaemon,
} from "../../../src/daemon/process.js";

describe("CLI daemon process functions (integration)", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  describe("getDaemonStatus", () => {
    it("returns not running when PID file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const status = await getDaemonStatus();

      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
      expect(status.uptime).toBeNull();
    });

    it("returns not running for invalid PID file content", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("not-a-number");

      const status = await getDaemonStatus();

      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
    });

    it("detects running daemon via PID check", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(String(process.pid)); // Our own PID - always alive
      vi.mocked(fs.statSync).mockReturnValue({
        mtimeMs: Date.now() - 60000,
      } as any);

      const status = await getDaemonStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
      expect(status.uptime).toBeGreaterThan(0);
    });

    it("cleans up stale PID file for dead process", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("999999999"); // Very unlikely to be alive

      // Mock process.kill to throw (process not found)
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation((_pid: number, signal?: string | number) => {
        throw new Error("ESRCH");
      }) as any;

      const status = await getDaemonStatus();

      expect(status.running).toBe(false);
      // Should have cleaned up stale PID file
      expect(fs.unlinkSync).toHaveBeenCalled();

      process.kill = originalKill;
    });
  });

  describe("stopDaemon", () => {
    it("returns false when daemon is not running", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await stopDaemon();

      expect(result).toBe(false);
    });
  });

  describe("sendToDaemon", () => {
    it("returns false when socket does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = await sendToDaemon({ event: "test" });

      expect(result).toBe(false);
    });
  });
});
