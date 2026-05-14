import { describe, it, expect } from "vitest";
import {
  countTokens,
  estimateTokens,
  calculateUsagePercent,
  formatTokens,
} from "../../../src/utils/tokens.js";

describe("estimateTokens", () => {
  it("returns > 0 for non-empty text", () => {
    expect(estimateTokens("Hello world, this is a test")).toBeGreaterThan(0);
  });

  it("returns 0-1 for empty string", () => {
    // empty string split on whitespace gives [""] which is 1 word
    const result = estimateTokens("");
    expect(result).toBeLessThanOrEqual(1);
  });

  it("gives reasonable estimates for English prose", () => {
    const prose = "The quick brown fox jumps over the lazy dog near the riverbank";
    const tokens = estimateTokens(prose);
    // ~12 words, expect roughly 10-20 tokens
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(30);
  });

  it("gives reasonable estimates for code", () => {
    const code = 'function hello() { return "world"; }';
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(25);
  });
});

describe("countTokens", () => {
  it("delegates to estimateTokens (returns same value)", () => {
    const text = "Test string for counting";
    expect(countTokens(text)).toBe(estimateTokens(text));
  });
});

describe("calculateUsagePercent", () => {
  it("calculates basic percentage", () => {
    expect(calculateUsagePercent(100000, 200000)).toBe(0.5);
  });

  it("returns 0 when maxTokens is 0", () => {
    expect(calculateUsagePercent(100, 0)).toBe(0);
  });

  it("returns 0 when maxTokens is negative", () => {
    expect(calculateUsagePercent(100, -1)).toBe(0);
  });

  it("handles 100% usage", () => {
    expect(calculateUsagePercent(200000, 200000)).toBe(1);
  });

  it("handles usage exceeding max", () => {
    expect(calculateUsagePercent(300000, 200000)).toBe(1.5);
  });
});

describe("formatTokens", () => {
  it("formats millions with M suffix", () => {
    expect(formatTokens(1500000)).toBe("1.5M");
    expect(formatTokens(1000000)).toBe("1.0M");
  });

  it("formats thousands with k suffix", () => {
    expect(formatTokens(150000)).toBe("150.0k");
    expect(formatTokens(1000)).toBe("1.0k");
    expect(formatTokens(82400)).toBe("82.4k");
  });

  it("formats small numbers without suffix", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(42)).toBe("42");
  });
});
