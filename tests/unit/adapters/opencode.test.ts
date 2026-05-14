import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("sql.js", () => ({
  default: vi.fn(),
}));
vi.mock("../../../src/utils/paths.js", () => ({
  getOpenCodeDbPath: () => "/home/user/.local/share/opencode/opencode.db",
  getDeslopifyHome: () => "/home/user/.deslopify",
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import initSqlJs from "sql.js";
import { OpenCodeAdapter } from "../../../src/adapters/opencode.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["opencode"],
  summarization: { provider: "same-cli", maxSummaryTokens: 2000, prompt: "Summarize" },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
  models: { "claude-sonnet-4-20250514": 200000 },
};

function createMockDb(queryResults: Record<string, any[]>) {
  return {
    prepare: vi.fn((sql: string) => {
      // Match most specific key first (longest match wins)
      const keys = Object.keys(queryResults).sort((a, b) => b.length - a.length);
      const key = keys.find((k) => sql.includes(k)) || "";
      const results = queryResults[key] || [];
      let idx = 0;
      return {
        bind: vi.fn().mockReturnValue(true),
        step: vi.fn(() => idx < results.length),
        getAsObject: vi.fn(() => results[idx++]),
        free: vi.fn(),
        reset: vi.fn(),
      };
    }),
    close: vi.fn(),
  };
}

describe("OpenCodeAdapter", () => {
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    adapter = new OpenCodeAdapter(config);
  });

  describe("isAvailable", () => {
    it("returns true when opencode command + DB exist", async () => {
      vi.mocked(childProcess.execSync).mockReturnValue("/usr/bin/opencode" as any);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns false when opencode not found", async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(await adapter.isAvailable()).toBe(false);
    });

    it("returns false when DB file missing", async () => {
      vi.mocked(childProcess.execSync).mockReturnValue("/usr/bin/opencode" as any);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("getActiveSessions", () => {
    it("returns sessions from database with token data from parts", async () => {
      const mockDb = createMockDb({
        session: [
          {
            id: "ses_1",
            project_id: "/project",
            model: "claude-sonnet-4-20250514",
            tokens_input: 0,
            tokens_output: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_compacting: null,
            time_archived: null,
          },
        ],
        "step-finish": [
          {
            data: JSON.stringify({ type: "step-finish", tokens: { total: 75000, input: 3, output: 1500, reasoning: 0, cache: { write: 73000, read: 0 } }, cost: 0, reason: "stop" }),
          },
        ],
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("fake-db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const sessions = await adapter.getActiveSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe("ses_1");
      expect(sessions[0].tokensUsed).toBe(75000);
      expect(sessions[0].cli).toBe("opencode");
    });

    it("filters out sessions with no step-finish parts (no activity)", async () => {
      const mockDb = createMockDb({
        session: [
          {
            id: "ses_1",
            project_id: "/project",
            model: "claude-sonnet-4-20250514",
            tokens_input: 0,
            tokens_output: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_compacting: null,
            time_archived: null,
          },
        ],
        // No step-finish entries
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("fake-db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const sessions = await adapter.getActiveSessions();
      expect(sessions.length).toBe(0);
    });

    it("returns empty on DB error", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("read fail");
      });
      vi.mocked(initSqlJs).mockRejectedValue(new Error("init fail"));

      const sessions = await adapter.getActiveSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("getTokenUsage", () => {
    it("reads token total from latest step-finish part", async () => {
      const mockDb = createMockDb({
        session: [
          {
            id: "ses_1",
            model: "claude-sonnet-4-20250514",
            tokens_input: 0,
            tokens_output: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
          },
        ],
        "step-finish": [
          {
            data: JSON.stringify({ type: "step-finish", tokens: { total: 8500, input: 3, output: 500, reasoning: 0, cache: { write: 8000, read: 0 } }, cost: 0, reason: "stop" }),
          },
        ],
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const result = await adapter.getTokenUsage("ses_1");
      expect(result).not.toBeNull();
      expect(result!.used).toBe(8500);
      expect(result!.model).toBe("claude-sonnet-4-20250514");
    });

    it("returns null for unknown session", async () => {
      const mockDb = createMockDb({ session: [] });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const result = await adapter.getTokenUsage("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("getTranscript", () => {
    it("parses JSON data column from messages", async () => {
      const mockDb = createMockDb({
        message: [
          { data: JSON.stringify({ role: "user", content: "hello" }) },
          { data: JSON.stringify({ role: "assistant", content: "hi there" }) },
        ],
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const transcript = await adapter.getTranscript("ses_1");
      expect(transcript).toContain("USER: hello");
      expect(transcript).toContain("ASSISTANT: hi there");
    });

    it("handles content as array of text blocks", async () => {
      const mockDb = createMockDb({
        message: [
          {
            data: JSON.stringify({
              role: "assistant",
              content: [
                { type: "text", text: "Part A" },
                { type: "tool_use", name: "bash" },
                { type: "text", text: "Part B" },
              ],
            }),
          },
        ],
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const transcript = await adapter.getTranscript("ses_1");
      expect(transcript).toContain("Part A");
      expect(transcript).toContain("Part B");
    });
  });

  describe("parseModelId (via getActiveSessions)", () => {
    it("extracts ID from JSON model string", async () => {
      const mockDb = createMockDb({
        session: [
          {
            id: "ses_1",
            project_id: "/project",
            model: '{"id":"claude-opus-4.6","providerID":"github-copilot"}',
            tokens_input: 0,
            tokens_output: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_compacting: null,
            time_archived: null,
          },
        ],
        "step-finish": [
          {
            data: JSON.stringify({ type: "step-finish", tokens: { total: 50000, input: 3, output: 1000, reasoning: 0, cache: { write: 49000, read: 0 } }, cost: 0, reason: "stop" }),
          },
        ],
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("db") as any);
      vi.mocked(initSqlJs).mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) } as any);

      const sessions = await adapter.getActiveSessions();
      expect(sessions[0].model).toBe("claude-opus-4.6");
    });
  });

  describe("install", () => {
    it("creates plugin files", async () => {
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
      vi.mocked(childProcess.execSync).mockReturnValue("" as any);

      await adapter.install();

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThanOrEqual(2); // package.json + index.js
    });
  });

  describe("uninstall", () => {
    it("removes plugin directory", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.rmSync).mockReturnValue(undefined);

      await adapter.uninstall();
      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledWith(
        expect.stringContaining("opencode"),
        { recursive: true }
      );
    });
  });
});
