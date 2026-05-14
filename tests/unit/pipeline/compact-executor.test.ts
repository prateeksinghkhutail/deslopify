import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { Compactor } from "../../../src/pipeline/compact-executor.js";

describe("Compactor", () => {
  let compactor: Compactor;

  beforeEach(() => {
    compactor = new Compactor();
  });

  describe("execute", () => {
    it("returns true when adapter.compact succeeds", async () => {
      const adapter = {
        compact: vi.fn().mockResolvedValue(true),
      } as any;

      const result = await compactor.execute("session-1", adapter);

      expect(result).toBe(true);
      expect(adapter.compact).toHaveBeenCalledWith("session-1");
    });

    it("returns false when adapter.compact returns false", async () => {
      const adapter = {
        compact: vi.fn().mockResolvedValue(false),
      } as any;

      const result = await compactor.execute("session-1", adapter);

      expect(result).toBe(false);
    });

    it("returns false when adapter.compact throws", async () => {
      const adapter = {
        compact: vi.fn().mockRejectedValue(new Error("compact failed")),
      } as any;

      const result = await compactor.execute("session-1", adapter);

      expect(result).toBe(false);
    });

    it("calls adapter.compact with correct session ID", async () => {
      const adapter = {
        compact: vi.fn().mockResolvedValue(true),
      } as any;

      await compactor.execute("my-unique-session", adapter);

      expect(adapter.compact).toHaveBeenCalledTimes(1);
      expect(adapter.compact).toHaveBeenCalledWith("my-unique-session");
    });
  });
});
