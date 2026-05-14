import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ContextTracker } from "../../../src/monitor/context-tracker.js";
import type { DeslopifyConfig, SessionInfo } from "../../../src/config/loader.js";

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

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "test-session",
    cli: "claude-code",
    projectPath: "/project",
    model: "claude-sonnet-4-20250514",
    tokensUsed: 50000,
    maxTokens: 200000,
    percentUsed: 0.25,
    status: "active",
    lastActivity: Date.now(),
    ...overrides,
  };
}

describe("ContextTracker", () => {
  let tracker: ContextTracker;

  beforeEach(() => {
    tracker = new ContextTracker(config);
  });

  describe("check", () => {
    it("returns thresholdHit=true when at threshold", async () => {
      const session = makeSession({ tokensUsed: 80000, maxTokens: 200000 }); // 40%
      const status = await tracker.check(session);
      expect(status.thresholdHit).toBe(true);
      expect(status.percentUsed).toBe(0.4);
    });

    it("returns thresholdHit=true when above threshold", async () => {
      const session = makeSession({ tokensUsed: 120000, maxTokens: 200000 }); // 60%
      const status = await tracker.check(session);
      expect(status.thresholdHit).toBe(true);
    });

    it("returns thresholdHit=false when below threshold", async () => {
      const session = makeSession({ tokensUsed: 60000, maxTokens: 200000 }); // 30%
      const status = await tracker.check(session);
      expect(status.thresholdHit).toBe(false);
    });

    it("tracks history for session", async () => {
      const session = makeSession({ id: "s1", tokensUsed: 1000 });
      await tracker.check(session);
      session.tokensUsed = 2000;
      await tracker.check(session);

      // Growth rate should now be computable
      const rate = tracker.getGrowthRate("s1");
      expect(rate).not.toBeNull();
    });

    it("caps history at 100 entries", async () => {
      for (let i = 0; i < 110; i++) {
        await tracker.check(makeSession({ id: "s1", tokensUsed: i * 100 }));
      }
      // Internal check - growth rate should still work (implying history exists)
      const rate = tracker.getGrowthRate("s1");
      expect(rate).not.toBeNull();
    });

    it("handles maxTokens of 0 (percentUsed = 0)", async () => {
      const session = makeSession({ tokensUsed: 100, maxTokens: 0 });
      const status = await tracker.check(session);
      expect(status.percentUsed).toBe(0);
      expect(status.thresholdHit).toBe(false);
    });
  });

  describe("getGrowthRate", () => {
    it("returns null with fewer than 2 data points", () => {
      expect(tracker.getGrowthRate("unknown")).toBeNull();
    });

    it("returns null after single check", async () => {
      await tracker.check(makeSession({ id: "s1", tokensUsed: 1000 }));
      expect(tracker.getGrowthRate("s1")).toBeNull();
    });

    it("calculates positive rate", async () => {
      await tracker.check(makeSession({ id: "s1", tokensUsed: 1000 }));
      await tracker.check(makeSession({ id: "s1", tokensUsed: 2000 }));
      const rate = tracker.getGrowthRate("s1");
      expect(rate).not.toBeNull();
      expect(rate!).toBeGreaterThan(0);
    });
  });

  describe("estimateTimeToThreshold", () => {
    it("returns null with no growth data", () => {
      const session = makeSession({ tokensUsed: 50000 });
      expect(tracker.estimateTimeToThreshold("s1", session)).toBeNull();
    });

    it("returns 0 if already past threshold", async () => {
      await tracker.check(makeSession({ id: "s1", tokensUsed: 1000 }));
      await tracker.check(makeSession({ id: "s1", tokensUsed: 2000 }));

      const session = makeSession({
        id: "s1",
        tokensUsed: 100000,
        maxTokens: 200000,
      }); // Already at 50% > 40%
      const time = tracker.estimateTimeToThreshold("s1", session);
      expect(time).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears session history", async () => {
      await tracker.check(makeSession({ id: "s1", tokensUsed: 1000 }));
      await tracker.check(makeSession({ id: "s1", tokensUsed: 2000 }));
      expect(tracker.getGrowthRate("s1")).not.toBeNull();

      tracker.reset("s1");
      expect(tracker.getGrowthRate("s1")).toBeNull();
    });
  });

  describe("getStatus", () => {
    it("returns null when adapter returns no usage", async () => {
      const mockAdapter = {
        getTokenUsage: vi.fn().mockResolvedValue(null),
      } as any;
      const result = await tracker.getStatus("s1", mockAdapter);
      expect(result).toBeNull();
    });

    it("returns status from adapter data", async () => {
      const mockAdapter = {
        getTokenUsage: vi.fn().mockResolvedValue({
          used: 80000,
          model: "claude-sonnet-4-20250514",
        }),
      } as any;
      const result = await tracker.getStatus("s1", mockAdapter);
      expect(result).not.toBeNull();
      expect(result!.tokensUsed).toBe(80000);
      expect(result!.thresholdHit).toBe(true); // 80k/200k = 40%
    });
  });
});
