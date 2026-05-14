import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("chokidar", () => ({
  watch: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  }),
}));
vi.mock("../../../src/utils/paths.js", () => ({
  getClaudeCodeProjectsDir: () => "/home/user/.claude/projects",
  getOpenCodeDbPath: () => "/home/user/.local/share/opencode/opencode.db",
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as fs from "node:fs";
import { watch } from "chokidar";
import { FilesystemAdapter } from "../../../src/adapters/filesystem.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code"],
  summarization: { provider: "same-cli", maxSummaryTokens: 2000, prompt: "Summarize" },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
  models: { "claude-sonnet-4-20250514": 200000 },
};

describe("FilesystemAdapter", () => {
  let adapter: FilesystemAdapter;

  beforeEach(() => {
    // Re-establish chokidar mock (mockReset clears mockReturnValue)
    vi.mocked(watch).mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    } as any);
    adapter = new FilesystemAdapter(config);
  });

  it("isAvailable always returns true", async () => {
    expect(await adapter.isAvailable()).toBe(true);
  });

  describe("startWatching", () => {
    it("initializes chokidar watcher when paths exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const callback = vi.fn();

      adapter.startWatching(callback);

      expect(watch).toHaveBeenCalled();
      const watchArgs = vi.mocked(watch).mock.calls[0];
      expect(watchArgs[0]).toBeInstanceOf(Array);
    });

    it("warns and returns when no paths found", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const callback = vi.fn();

      adapter.startWatching(callback);

      // Should not have created a watcher
      expect(watch).not.toHaveBeenCalled();
    });
  });

  it("compact always returns false (FS adapter cannot compact)", async () => {
    expect(await adapter.compact("any-session")).toBe(false);
  });

  it("injectMessage always returns false", async () => {
    expect(await adapter.injectMessage("any", "msg")).toBe(false);
  });

  it("isIdle always returns true", async () => {
    expect(await adapter.isIdle("any")).toBe(true);
  });

  it("getProjectPath returns process.cwd()", async () => {
    const result = await adapter.getProjectPath("any");
    expect(result).toBe(process.cwd());
  });

  describe("getActiveSessions", () => {
    it("filters out files older than 30 minutes", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation((p) => {
        const ps = String(p);
        if (ps.includes("projects")) return ["proj1"] as any;
        return ["old-session.jsonl"] as any;
      });
      vi.mocked(fs.statSync).mockImplementation((p) => {
        const ps = String(p);
        if (ps.endsWith(".jsonl")) {
          return {
            isDirectory: () => false,
            mtimeMs: Date.now() - 60 * 60 * 1000, // 1 hour ago
            size: 1000,
          } as any;
        }
        return { isDirectory: () => true } as any;
      });

      const sessions = await adapter.getActiveSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("stopWatching", () => {
    it("closes the watcher", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      adapter.startWatching(vi.fn());

      adapter.stopWatching();
      // Watcher should have been closed (no error thrown)
    });
  });
});
