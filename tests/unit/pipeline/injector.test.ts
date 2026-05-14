import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Injector } from "../../../src/pipeline/injector.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";
import type { Summary } from "../../../src/pipeline/summarizer.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code"],
  summarization: {
    provider: "same-cli",
    maxSummaryTokens: 2000,
    prompt: "Summarize",
  },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
  models: {},
};

function makeSummary(overrides?: Partial<Summary>): Summary {
  return {
    decisions: ["Use TypeScript", "Deploy to AWS"],
    completedTasks: ["Scaffold project", "Write tests"],
    openIssues: ["Flaky CI"],
    currentGoals: ["Ship v1", "Add docs"],
    rawSummary: "raw",
    timestamp: 1700000000000,
    sessionId: "abc12345-dead-beef",
    model: "claude-sonnet-4-20250514",
    tokensAtCompaction: 80000,
    ...overrides,
  };
}

describe("Injector", () => {
  let injector: Injector;

  beforeEach(() => {
    injector = new Injector(config);
  });

  describe("buildInjectionMessage", () => {
    it("includes context restored header", () => {
      const msg = injector.buildInjectionMessage(makeSummary());
      expect(msg).toContain("[Context Restored by deslopify]");
    });

    it("includes all summary sections", () => {
      const msg = injector.buildInjectionMessage(makeSummary());

      expect(msg).toContain("**Key Decisions:**");
      expect(msg).toContain("Use TypeScript");
      expect(msg).toContain("Deploy to AWS");

      expect(msg).toContain("**Completed:**");
      expect(msg).toContain("Scaffold project");
      expect(msg).toContain("Write tests");

      expect(msg).toContain("**Open Issues:**");
      expect(msg).toContain("Flaky CI");

      expect(msg).toContain("**Current Goals (continue from here):**");
      expect(msg).toContain("Ship v1");
      expect(msg).toContain("Add docs");
    });

    it("includes session ID reference to memory file", () => {
      const msg = injector.buildInjectionMessage(makeSummary());
      expect(msg).toContain("abc12345...");
      expect(msg).toContain("project-memory.md");
    });

    it("omits empty sections", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          decisions: [],
          openIssues: [],
        })
      );

      expect(msg).not.toContain("**Key Decisions:**");
      expect(msg).not.toContain("**Open Issues:**");

      // Non-empty sections should still be present
      expect(msg).toContain("**Completed:**");
      expect(msg).toContain("**Current Goals");
    });

    it("limits decisions to 5 items", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          decisions: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"],
        })
      );

      expect(msg).toContain("d5");
      expect(msg).not.toContain("d6");
    });

    it("limits completed tasks to 5 items", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          completedTasks: ["t1", "t2", "t3", "t4", "t5", "t6"],
        })
      );

      expect(msg).toContain("t5");
      expect(msg).not.toContain("t6");
    });

    it("limits open issues to 3 items", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          openIssues: ["i1", "i2", "i3", "i4"],
        })
      );

      expect(msg).toContain("i3");
      expect(msg).not.toContain("i4");
    });

    it("does not limit current goals", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          currentGoals: ["g1", "g2", "g3", "g4", "g5", "g6"],
        })
      );

      expect(msg).toContain("g6");
    });

    it("produces clean output with all sections empty", () => {
      const msg = injector.buildInjectionMessage(
        makeSummary({
          decisions: [],
          completedTasks: [],
          openIssues: [],
          currentGoals: [],
        })
      );

      expect(msg).toContain("[Context Restored by deslopify]");
      expect(msg).toContain("abc12345...");
      // No section headers
      expect(msg).not.toContain("**Key Decisions:**");
      expect(msg).not.toContain("**Completed:**");
    });
  });

  describe("truncateToTokenBudget", () => {
    it("returns message unchanged when within budget", () => {
      const short = "short message";
      expect(injector.truncateToTokenBudget(short)).toBe(short);
    });

    it("truncates message exceeding token budget", () => {
      // config.injection.maxInjectTokens = 1500 => maxChars = 6000
      const long = "a".repeat(7000);
      const result = injector.truncateToTokenBudget(long);

      expect(result.length).toBeLessThan(long.length);
      expect(result).toContain("[message truncated to fit token budget]");
    });

    it("truncates to correct character count", () => {
      const maxChars = config.injection.maxInjectTokens * 4; // 6000
      const long = "b".repeat(maxChars + 1000);
      const result = injector.truncateToTokenBudget(long);

      // The truncated body should be maxChars long before the suffix
      const suffix = "\n\n_[message truncated to fit token budget]_";
      expect(result).toBe("b".repeat(maxChars) + suffix);
    });

    it("handles exact boundary without truncation", () => {
      const maxChars = config.injection.maxInjectTokens * 4;
      const exact = "c".repeat(maxChars);
      expect(injector.truncateToTokenBudget(exact)).toBe(exact);
    });
  });
});
