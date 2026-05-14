import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { IdleDetector } from "../../../src/monitor/idle-detector.js";
import type { DeslopifyConfig } from "../../../src/config/loader.js";

const config: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code"],
  summarization: { provider: "same-cli", maxSummaryTokens: 2000, prompt: "Summarize" },
  injection: { method: "first-message", maxInjectTokens: 1500 },
  idle: { waitMs: 100, maxWaitMs: 500, checkInterval: 50 },
  models: {},
};

describe("IdleDetector", () => {
  let detector: IdleDetector;

  beforeEach(() => {
    detector = new IdleDetector(config);
  });

  describe("waitForIdle", () => {
    it("returns true after consecutive idle checks", async () => {
      const adapter = {
        isIdle: vi.fn().mockResolvedValue(true),
      } as any;

      const result = await detector.waitForIdle("s1", adapter);
      expect(result).toBe(true);
      expect(adapter.isIdle).toHaveBeenCalled();
    });

    it("resets counter on non-idle check", async () => {
      let callCount = 0;
      const adapter = {
        isIdle: vi.fn().mockImplementation(async () => {
          callCount++;
          // busy, busy, then idle forever
          return callCount > 2;
        }),
      } as any;

      const result = await detector.waitForIdle("s1", adapter);
      expect(result).toBe(true);
      // Should have needed more calls due to reset
      expect(adapter.isIdle.mock.calls.length).toBeGreaterThan(2);
    });

    it("returns false on timeout", async () => {
      const adapter = {
        isIdle: vi.fn().mockResolvedValue(false), // Never idle
      } as any;

      const result = await detector.waitForIdle("s1", adapter);
      expect(result).toBe(false);
    });
  });

  describe("isCurrentlyIdle", () => {
    it("delegates to adapter.isIdle", async () => {
      const adapter = {
        isIdle: vi.fn().mockResolvedValue(true),
      } as any;

      const result = await detector.isCurrentlyIdle("s1", adapter);
      expect(result).toBe(true);
      expect(adapter.isIdle).toHaveBeenCalledWith("s1");
    });
  });
});
