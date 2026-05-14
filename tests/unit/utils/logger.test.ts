import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock fs and os BEFORE the logger module is imported
// because the Logger constructor runs immediately on import
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

describe("logger", () => {
  let logger: any;

  beforeEach(async () => {
    vi.resetModules();
    // Re-import to get a fresh Logger instance
    const mod = await import("../../../src/utils/logger.js");
    logger = mod.logger;
  });

  it("info writes to console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("test message");
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain("INFO");
    expect(spy.mock.calls[0][0]).toContain("test message");
  });

  it("error writes to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("error msg");
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain("ERROR");
  });

  it("warn writes to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn("warning msg");
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toContain("WARN");
  });

  it("format includes ISO timestamp", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("timestamp test");
    // ISO format: YYYY-MM-DDTHH:MM:SS
    expect(spy.mock.calls[0][0]).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  });

  it("metadata object is JSON-stringified in output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("with meta", { key: "value", num: 42 });
    expect(spy.mock.calls[0][0]).toContain('"key":"value"');
    expect(spy.mock.calls[0][0]).toContain('"num":42');
  });

  it("setLevel changes filtering - debug hidden when level=warn", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    logger.setLevel("warn");
    logger.debug("should not appear");
    logger.info("should not appear either");

    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
