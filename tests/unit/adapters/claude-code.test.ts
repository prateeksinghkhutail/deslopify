import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:child_process");
vi.mock("../../../src/utils/paths.js", () => ({
  getClaudeCodeHome: () => "/home/user/.claude",
  getClaudeCodeSessionsDir: () => "/home/user/.claude/sessions",
  getClaudeCodeProjectsDir: () => "/home/user/.claude/projects",
  getClaudeCodeSettingsPath: () => "/home/user/.claude/settings.json",
  getDeslopifyHome: () => "/home/user/.deslopify",
  encodeProjectPath: (p: string) => p.replace(/\//g, "-"),
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as fs from "node:fs";
import * as childProcess from "node:child_process";
import { ClaudeCodeAdapter } from "../../../src/adapters/claude-code.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code"],
  summarization: { provider: "same-cli", maxSummaryTokens: 2000, prompt: "Summarize" },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
  models: { "claude-sonnet-4-20250514": 200000, "gpt-4o": 128000 },
};

describe("ClaudeCodeAdapter", () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter(config);
  });

  describe("isAvailable", () => {
    it("returns true when claude is found", async () => {
      vi.mocked(childProcess.execSync).mockReturnValue("/usr/bin/claude" as any);
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("returns false when claude not found", async () => {
      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe("getActiveSessions", () => {
    it("returns empty when sessions dir missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(await adapter.getActiveSessions()).toEqual([]);
    });

    it("skips stale session files with dead PIDs", async () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const ps = String(p);
        if (ps.includes("sessions")) return true;
        if (ps.includes("projects")) return false;
        return false;
      });
      vi.mocked(fs.readdirSync).mockReturnValue(["1234.json"] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({
          pid: 99999999,
          sessionId: "test-session",
          cwd: "/project",
          startedAt: Date.now(),
          status: "idle",
        })
      );
      // process.kill(99999999, 0) should throw => stale
      const origKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error("ESRCH");
      }) as any;

      const sessions = await adapter.getActiveSessions();
      expect(sessions).toEqual([]);

      process.kill = origKill;
    });
  });

  describe("getTokenUsage", () => {
    it("returns null for unknown session (no transcript file)", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(await adapter.getTokenUsage("nonexistent")).toBeNull();
    });

    it("parses token counts from JSONL", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["project1"] as any);

      const jsonl = [
        JSON.stringify({ type: "user", message: "hello" }),
        JSON.stringify({
          type: "assistant",
          message: {
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "Hi" }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 200,
              cache_read_input_tokens: 150,
            },
          },
        }),
      ].join("\n");

      vi.mocked(fs.readFileSync).mockReturnValue(jsonl);

      const result = await adapter.getTokenUsage("test-session");
      expect(result).not.toBeNull();
      expect(result!.used).toBe(500); // 100+50+200+150
      expect(result!.model).toBe("claude-sonnet-4-20250514");
    });

    it("reads JSONL backwards to find last assistant message", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["project1"] as any);

      const jsonl = [
        JSON.stringify({
          type: "assistant",
          message: {
            model: "old-model",
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
        JSON.stringify({ type: "user", message: "more stuff" }),
        JSON.stringify({
          type: "assistant",
          message: {
            model: "new-model",
            usage: { input_tokens: 300, output_tokens: 200 },
          },
        }),
      ].join("\n");

      vi.mocked(fs.readFileSync).mockReturnValue(jsonl);

      const result = await adapter.getTokenUsage("test-session");
      expect(result!.model).toBe("new-model");
      expect(result!.used).toBe(500); // 300+200
    });
  });

  describe("isIdle", () => {
    it("returns true when session status is idle", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["1.json"] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ sessionId: "s1", status: "idle" })
      );
      expect(await adapter.isIdle("s1")).toBe(true);
    });

    it("returns false when session status is busy", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["1.json"] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ sessionId: "s1", status: "busy" })
      );
      expect(await adapter.isIdle("s1")).toBe(false);
    });

    it("returns false when session not found", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["1.json"] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ sessionId: "other-id", status: "idle" })
      );
      expect(await adapter.isIdle("not-found")).toBe(false);
    });

    it("returns false when sessions dir missing", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(await adapter.isIdle("s1")).toBe(false);
    });
  });

  describe("getTranscript", () => {
    it("formats user and assistant messages", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["proj1"] as any);

      const jsonl = [
        JSON.stringify({ type: "user", message: "build a feature" }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "Sure, I will build it" }],
          },
        }),
      ].join("\n");

      vi.mocked(fs.readFileSync).mockReturnValue(jsonl);

      const transcript = await adapter.getTranscript("s1");
      expect(transcript).toContain("USER: build a feature");
      expect(transcript).toContain("ASSISTANT: Sure, I will build it");
    });

    it("handles assistant content as array of blocks", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["proj1"] as any);

      const jsonl = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Part 1" },
            { type: "tool_use", name: "bash" },
            { type: "text", text: "Part 2" },
          ],
        },
      });

      vi.mocked(fs.readFileSync).mockReturnValue(jsonl);

      const transcript = await adapter.getTranscript("s1");
      expect(transcript).toContain("Part 1");
      expect(transcript).toContain("Part 2");
      expect(transcript).not.toContain("bash");
    });

    it("returns last 50 messages max", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(["proj1"] as any);

      const lines = Array.from({ length: 60 }, (_, i) =>
        JSON.stringify({ type: "user", message: `msg ${i}` })
      ).join("\n");

      vi.mocked(fs.readFileSync).mockReturnValue(lines);

      const transcript = await adapter.getTranscript("s1");
      const parts = transcript.split("---");
      expect(parts.length).toBeLessThanOrEqual(51);
    });

    it("returns empty string when no transcript file found", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(await adapter.getTranscript("s1")).toBe("");
    });
  });

  describe("install", () => {
    it("writes hook scripts and modifies settings.json", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.readFileSync).mockReturnValue("{}");
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      await adapter.install();

      // Should have written hook scripts + settings.json
      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(writeCalls.length).toBeGreaterThanOrEqual(3); // 2 hook scripts + settings.json

      // Verify settings.json was written with hooks
      const settingsCall = writeCalls.find(
        (c) => String(c[0]).includes("settings.json")
      );
      expect(settingsCall).toBeDefined();
      const written = JSON.parse(String(settingsCall![1]));
      expect(written.hooks.PostToolUse).toBeDefined();
      expect(written.hooks.PostCompact).toBeDefined();
    });

    it("is idempotent - no duplicate hooks", async () => {
      const existingSettings = {
        hooks: {
          PostToolUse: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "/home/user/.deslopify/hooks/claude-post-tool.sh" }],
            },
          ],
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingSettings));
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      await adapter.install();

      const settingsCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        (c) => String(c[0]).includes("settings.json")
      );
      const written = JSON.parse(String(settingsCall![1]));
      // Should still have only 1 PostToolUse entry (not duplicated)
      expect(written.hooks.PostToolUse.length).toBe(1);
    });
  });

  describe("uninstall", () => {
    it("removes deslopify hooks from settings.json", async () => {
      const settings = {
        hooks: {
          PostToolUse: [
            { matcher: "", hooks: [{ type: "command", command: "/other/hook.sh" }] },
            { matcher: "", hooks: [{ type: "command", command: "/home/user/.deslopify/hooks/claude-post-tool.sh" }] },
          ],
          PostCompact: [
            { matcher: "", hooks: [{ type: "command", command: "/home/user/.deslopify/hooks/claude-post-compact.sh" }] },
          ],
        },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(settings));
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      await adapter.uninstall();

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const written = JSON.parse(String(writeCall[1]));
      // Should keep the non-deslopify hook
      expect(written.hooks.PostToolUse.length).toBe(1);
      expect(written.hooks.PostToolUse[0].hooks[0].command).toContain("other");
      // PostCompact should be deleted entirely (was only deslopify)
      expect(written.hooks.PostCompact).toBeUndefined();
    });
  });
});
