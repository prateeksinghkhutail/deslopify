import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getSocketPath: vi.fn(() => "/tmp/test-daemon.sock"),
  getPidFilePath: vi.fn(() => "/tmp/test-daemon.pid"),
  getDeslopifyHome: vi.fn(() => "/tmp/.deslopify"),
  getDefaultConfigPath: vi.fn(() => "/tmp/.deslopify/config.json"),
  getClaudeCodeHome: vi.fn(() => "/tmp/.claude"),
  getClaudeCodeSettingsPath: vi.fn(() => "/tmp/.claude/settings.json"),
  getClaudeCodeSessionsDir: vi.fn(() => "/tmp/.claude/sessions"),
  getClaudeCodeProjectsDir: vi.fn(() => "/tmp/.claude/projects"),
  getOpenCodeDbPath: vi.fn(() => "/tmp/.local/share/opencode/opencode.db"),
  getOpenCodeStorageDir: vi.fn(() => "/tmp/.local/share/opencode"),
  getMemoryFilePath: vi.fn(
    (projectPath: string, memoryFile: string) => `${projectPath}/${memoryFile}`
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

// Mock adapters - use plain vi.fn() and set implementations in beforeEach
vi.mock("../../../src/adapters/claude-code.js", () => ({
  ClaudeCodeAdapter: vi.fn(),
}));

vi.mock("../../../src/adapters/opencode.js", () => ({
  OpenCodeAdapter: vi.fn(),
}));

vi.mock("../../../src/adapters/filesystem.js", () => ({
  FilesystemAdapter: vi.fn(),
}));

import * as fs from "node:fs";
import { DeslopifyDaemon } from "../../../src/daemon/server.js";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.js";
import { OpenCodeAdapter } from "../../../src/adapters/opencode.js";
import { FilesystemAdapter } from "../../../src/adapters/filesystem.js";
import type { DeslopifyConfig, SessionInfo } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 60000,
  adapters: ["claude-code"],
  summarization: {
    provider: "same-cli",
    maxSummaryTokens: 2000,
    prompt: "Summarize",
  },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 100, maxWaitMs: 500, checkInterval: 50 },
  models: {},
};

function setupAdapterMocks() {
  const mockAdapter = {
    name: "claude-code",
    isAvailable: vi.fn().mockResolvedValue(true),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    getTokenUsage: vi.fn().mockResolvedValue(null),
    isIdle: vi.fn().mockResolvedValue(true),
    getTranscript: vi.fn().mockResolvedValue(""),
    compact: vi.fn().mockResolvedValue(true),
    injectMessage: vi.fn().mockResolvedValue(true),
    getProjectPath: vi.fn().mockResolvedValue("/project"),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  };

  vi.mocked(ClaudeCodeAdapter).mockImplementation(() => mockAdapter as any);

  vi.mocked(OpenCodeAdapter).mockImplementation(() => ({
    ...mockAdapter,
    name: "opencode",
  }) as any);

  vi.mocked(FilesystemAdapter).mockImplementation(() => ({
    startWatching: vi.fn(),
    stopWatching: vi.fn(),
  }) as any);

  return mockAdapter;
}

describe("DeslopifyDaemon (integration)", () => {
  let daemon: DeslopifyDaemon;

  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    setupAdapterMocks();
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
  });

  describe("constructor", () => {
    it("creates daemon with configured adapters", () => {
      daemon = new DeslopifyDaemon(config);
      const status = daemon.getStatus();

      expect(status.running).toBe(false);
      expect(status.adapters).toContain("claude-code");
      expect(status.compactingSessions).toEqual([]);
    });

    it("initializes multiple adapters when configured", () => {
      const multiConfig = {
        ...config,
        adapters: ["claude-code", "opencode"] as const,
      };
      daemon = new DeslopifyDaemon(multiConfig as DeslopifyConfig);
      const status = daemon.getStatus();

      expect(status.adapters).toContain("claude-code");
      expect(status.adapters).toContain("opencode");
    });
  });

  describe("getStatus", () => {
    it("reports not running before start", () => {
      daemon = new DeslopifyDaemon(config);
      const status = daemon.getStatus();

      expect(status.running).toBe(false);
      expect(status.compactingSessions).toEqual([]);
    });

    it("reports monitored sessions count", () => {
      daemon = new DeslopifyDaemon(config);
      const status = daemon.getStatus();

      // One adapter configured
      expect(status.monitoredSessions).toBe(1);
    });
  });

  describe("stop", () => {
    it("cleans up on stop when not started", async () => {
      daemon = new DeslopifyDaemon(config);

      vi.mocked(fs.existsSync).mockReturnValue(true);

      await daemon.stop();

      expect(daemon.getStatus().running).toBe(false);
    });

    it("handles missing socket file gracefully", async () => {
      daemon = new DeslopifyDaemon(config);

      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Should not throw
      await daemon.stop();
      expect(daemon.getStatus().running).toBe(false);
    });
  });
});
