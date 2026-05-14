import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("../../../src/utils/paths.js", () => ({
  getDefaultConfigPath: () => "/home/user/.deslopify/config.json",
  getProjectRoot: () => "/home/user/project",
}));
vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as fs from "node:fs";
import { loadConfig, getModelMaxTokens, type DeslopifyConfig } from "../../../src/config/loader.js";

const mockFs = vi.mocked(fs);

function makeConfig(overrides: Partial<DeslopifyConfig> = {}): DeslopifyConfig {
  return {
    threshold: 0.4,
    memoryFile: "project-memory.md",
    pollInterval: 5000,
    adapters: ["claude-code", "opencode"],
    summarization: {
      provider: "same-cli",
      maxSummaryTokens: 2000,
      prompt: "Summarize this",
    },
    injection: { method: "first-message", maxInjectTokens: 1500 },
    idle: { waitMs: 3000, maxWaitMs: 30000, checkInterval: 1000 },
    models: {
      "claude-sonnet-4-20250514": 200000,
      "claude-opus-4-20250514": 200000,
      "gpt-4o": 128000,
      "gpt-4o-mini": 128000,
      "o1": 200000,
    },
    ...overrides,
  } as DeslopifyConfig;
}

describe("loadConfig", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("returns DEFAULT_CONFIG when no config file exists", () => {
    const config = loadConfig();
    expect(config.threshold).toBe(0.4);
    expect(config.memoryFile).toBe("project-memory.md");
    expect(config.pollInterval).toBe(5000);
    expect(config.adapters).toEqual(["claude-code", "opencode"]);
    expect(config.idle.waitMs).toBe(3000);
  });

  it("loads and parses a valid config file", () => {
    const userConfig = JSON.stringify({ threshold: 0.6, memoryFile: "memory.md" });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(userConfig);

    const config = loadConfig("/some/path/config.json");
    expect(config.threshold).toBe(0.6);
    expect(config.memoryFile).toBe("memory.md");
  });

  it("deep-merges user config with defaults (nested keys preserved)", () => {
    const userConfig = JSON.stringify({ idle: { waitMs: 5000 } });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(userConfig);

    const config = loadConfig("/some/path/config.json");
    expect(config.idle.waitMs).toBe(5000);
    expect(config.idle.maxWaitMs).toBe(30000); // default preserved
    expect(config.idle.checkInterval).toBe(1000); // default preserved
  });

  it("skips $schema key during merge", () => {
    const userConfig = JSON.stringify({ $schema: "./schema.json", threshold: 0.5 });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(userConfig);

    const config = loadConfig("/some/path/config.json");
    expect((config as any).$schema).toBeUndefined();
    expect(config.threshold).toBe(0.5);
  });

  it("overwrites arrays instead of merging", () => {
    const userConfig = JSON.stringify({ adapters: ["claude-code"] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(userConfig);

    const config = loadConfig("/some/path/config.json");
    expect(config.adapters).toEqual(["claude-code"]);
  });

  it("falls back to defaults on JSON parse error", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("NOT VALID JSON {{{");

    const config = loadConfig("/some/path/config.json");
    expect(config.threshold).toBe(0.4);
  });
});

describe("getModelMaxTokens", () => {
  const config = makeConfig();

  it("exact match returns correct value", () => {
    expect(getModelMaxTokens("claude-sonnet-4-20250514", config)).toBe(200000);
    expect(getModelMaxTokens("gpt-4o", config)).toBe(128000);
    expect(getModelMaxTokens("o1", config)).toBe(200000);
  });

  it("partial/substring match works", () => {
    // Key "claude-sonnet-4-20250514" includes "claude-sonnet-4"
    expect(getModelMaxTokens("claude-sonnet-4", config)).toBe(200000);
  });

  it("parses JSON-encoded model objects (OpenCode format)", () => {
    const jsonModel = '{"id":"claude-opus-4.6","providerID":"github-copilot"}';
    // "claude-opus-4.6" starts with "claude" -> prefix fallback 200000
    expect(getModelMaxTokens(jsonModel, config)).toBe(200000);
  });

  it("prefix fallback for unknown claude model", () => {
    expect(getModelMaxTokens("claude-new-model-2026", config)).toBe(200000);
  });

  it("prefix fallback for unknown gpt-4 model", () => {
    expect(getModelMaxTokens("gpt-4-turbo-2026", config)).toBe(128000);
  });

  it("prefix fallback for o1 models", () => {
    expect(getModelMaxTokens("o1-preview", config)).toBe(200000);
  });

  it("prefix fallback for gemma models", () => {
    expect(getModelMaxTokens("gemma4:31b-cloud", config)).toBe(128000);
  });

  it("completely unknown model returns 200000 default", () => {
    expect(getModelMaxTokens("llama-70b-instruct", config)).toBe(200000);
  });
});
