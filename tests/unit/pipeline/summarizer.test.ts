import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { execSync } from "node:child_process";
import { Summarizer, type Summary } from "../../../src/pipeline/summarizer.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code"],
  summarization: {
    provider: "same-cli",
    maxSummaryTokens: 2000,
    prompt: "Summarize this conversation.",
  },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
  models: {},
};

const VALID_CLI_OUTPUT = `## Architectural Decisions
- Use TypeScript for the project
- Deploy to AWS Lambda

## Completed Tasks
- Set up project scaffolding
- Added unit tests

## Open Issues
- CI pipeline is flaky

## Current Goals
- Finish integration tests
- Ship v1.0`;

describe("Summarizer", () => {
  let summarizer: Summarizer;

  beforeEach(() => {
    summarizer = new Summarizer(config);
  });

  describe("summarize", () => {
    it("returns structured summary from CLI output", async () => {
      vi.mocked(execSync).mockReturnValue(VALID_CLI_OUTPUT);

      const result = await summarizer.summarize(
        "USER: hello\nASSISTANT: hi",
        "session-123",
        "claude-sonnet-4-20250514",
        80000,
        "claude-code"
      );

      expect(result.decisions).toEqual([
        "Use TypeScript for the project",
        "Deploy to AWS Lambda",
      ]);
      expect(result.completedTasks).toEqual([
        "Set up project scaffolding",
        "Added unit tests",
      ]);
      expect(result.openIssues).toEqual(["CI pipeline is flaky"]);
      expect(result.currentGoals).toEqual([
        "Finish integration tests",
        "Ship v1.0",
      ]);
      expect(result.sessionId).toBe("session-123");
      expect(result.model).toBe("claude-sonnet-4-20250514");
      expect(result.tokensAtCompaction).toBe(80000);
      expect(result.rawSummary).toBe(VALID_CLI_OUTPUT);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("calls claude --print for claude-code CLI", async () => {
      vi.mocked(execSync).mockReturnValue(VALID_CLI_OUTPUT);

      await summarizer.summarize("transcript", "s1", "model", 100, "claude-code");

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("claude --print"),
        expect.any(Object)
      );
    });

    it("calls opencode run for opencode CLI", async () => {
      vi.mocked(execSync).mockReturnValue(VALID_CLI_OUTPUT);

      await summarizer.summarize("transcript", "s1", "model", 100, "opencode");

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("opencode run"),
        expect.any(Object)
      );
    });

    it("uses fallback when CLI call fails", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("command not found");
      });

      const result = await summarizer.summarize(
        "USER: fix the bug\nASSISTANT: ok\nUSER: now deploy",
        "s1",
        "model",
        100,
        "claude-code"
      );

      // Fallback should still produce structured output
      expect(result.decisions).toContain(
        "Unable to generate AI summary (CLI unavailable)"
      );
      expect(result.rawSummary).toContain("Architectural Decisions");
      expect(result.rawSummary).toContain("Completed Tasks");
    });

    it("extracts stdout from non-zero exit code", async () => {
      const err = new Error("exit code 1") as any;
      err.stdout = VALID_CLI_OUTPUT;
      vi.mocked(execSync).mockImplementation(() => {
        throw err;
      });

      const result = await summarizer.summarize(
        "transcript",
        "s1",
        "model",
        100,
        "claude-code"
      );

      // Should have parsed the stdout successfully
      expect(result.decisions.length).toBeGreaterThan(0);
    });

    it("truncates long transcripts in prompt", async () => {
      vi.mocked(execSync).mockReturnValue(VALID_CLI_OUTPUT);

      const longTranscript = "x".repeat(50000);

      await summarizer.summarize(longTranscript, "s1", "model", 100, "claude-code");

      const callArgs = vi.mocked(execSync).mock.calls[0][0] as string;
      // The prompt should contain the truncation marker
      expect(callArgs).toContain("[earlier conversation truncated]");
    });

    it("does not truncate short transcripts", async () => {
      vi.mocked(execSync).mockReturnValue(VALID_CLI_OUTPUT);

      const shortTranscript = "USER: hello\nASSISTANT: hi";

      await summarizer.summarize(
        shortTranscript,
        "s1",
        "model",
        100,
        "claude-code"
      );

      const callArgs = vi.mocked(execSync).mock.calls[0][0] as string;
      expect(callArgs).not.toContain("[earlier conversation truncated]");
    });
  });

  describe("parseSummary (via summarize)", () => {
    it("handles missing sections gracefully", async () => {
      // Only one section present; text after bullet is captured since regex
      // runs until next ## or end-of-string
      vi.mocked(execSync).mockReturnValue(
        "## Architectural Decisions\n- one thing\n\n## Completed Tasks\n- done stuff"
      );

      const result = await summarizer.summarize(
        "transcript",
        "s1",
        "model",
        100,
        "claude-code"
      );

      expect(result.decisions).toEqual(["one thing"]);
      expect(result.completedTasks).toEqual(["done stuff"]);
      expect(result.openIssues).toEqual([]);
      expect(result.currentGoals).toEqual([]);
    });

    it("handles empty CLI output", async () => {
      vi.mocked(execSync).mockReturnValue("");

      const result = await summarizer.summarize(
        "transcript",
        "s1",
        "model",
        100,
        "claude-code"
      );

      expect(result.decisions).toEqual([]);
      expect(result.completedTasks).toEqual([]);
      expect(result.openIssues).toEqual([]);
      expect(result.currentGoals).toEqual([]);
    });

    it("strips bullet prefixes (- and *)", async () => {
      vi.mocked(execSync).mockReturnValue(
        "## Architectural Decisions\n- decision one\n* decision two"
      );

      const result = await summarizer.summarize(
        "transcript",
        "s1",
        "model",
        100,
        "claude-code"
      );

      expect(result.decisions).toEqual(["decision one", "decision two"]);
    });
  });

  describe("fallbackSummary (via summarize when CLI fails)", () => {
    it("includes user message excerpts in goals", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("fail");
      });

      const transcript = [
        "USER: first task",
        "ASSISTANT: ok",
        "USER: second task",
        "ASSISTANT: done",
        "USER: third task here that is the current focus",
      ].join("\n");

      const result = await summarizer.summarize(
        transcript,
        "s1",
        "model",
        100,
        "claude-code"
      );

      // Fallback should reference recent user messages as goals
      expect(result.rawSummary).toContain("Current Goals");
      expect(result.rawSummary).toContain("third task");
    });
  });
});
