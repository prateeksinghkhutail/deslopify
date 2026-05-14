import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing summarizer (which it re-exports via pipeline)
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../src/utils/paths.js", () => ({
  getMemoryFilePath: vi.fn(
    (projectPath: string, memoryFile: string) => `${projectPath}/${memoryFile}`
  ),
  ensureDir: vi.fn(),
}));

vi.mock("../../../src/utils/tokens.js", () => ({
  formatTokens: vi.fn((n: number) => `${(n / 1000).toFixed(1)}k`),
}));

import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { CompactionPipeline } from "../../../src/pipeline/compactor.js";
import type { DeslopifyConfig, SessionInfo } from "../../../src/config/loader.js";
import type { BaseAdapter } from "../../../src/adapters/base.js";

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

const VALID_SUMMARY = `## Architectural Decisions
- Use TypeScript

## Completed Tasks
- Set up project

## Open Issues
- None

## Current Goals
- Ship v1`;

function makeSession(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: "test-session-123",
    cli: "claude-code",
    projectPath: "/project",
    model: "claude-sonnet-4-20250514",
    tokensUsed: 80000,
    maxTokens: 200000,
    percentUsed: 0.4,
    status: "active",
    lastActivity: Date.now(),
    ...overrides,
  };
}

function makeAdapter(overrides?: Partial<BaseAdapter>): BaseAdapter {
  return {
    name: "claude-code" as const,
    isAvailable: vi.fn().mockResolvedValue(true),
    getActiveSessions: vi.fn().mockResolvedValue([]),
    getTokenUsage: vi.fn().mockResolvedValue({ used: 80000, model: "claude-sonnet-4-20250514" }),
    isIdle: vi.fn().mockResolvedValue(true),
    getTranscript: vi.fn().mockResolvedValue("USER: hello\nASSISTANT: hi"),
    compact: vi.fn().mockResolvedValue(true),
    injectMessage: vi.fn().mockResolvedValue(true),
    getProjectPath: vi.fn().mockResolvedValue("/project"),
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as BaseAdapter;
}

describe("CompactionPipeline (integration)", () => {
  let pipeline: CompactionPipeline;

  beforeEach(() => {
    pipeline = new CompactionPipeline(config);
    // Default: execSync returns valid summary, fs stubs for memory writes
    vi.mocked(execSync).mockReturnValue(VALID_SUMMARY);
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("executes full pipeline: transcript -> summarize -> write -> compact -> inject", async () => {
    const adapter = makeAdapter();

    await pipeline.execute(makeSession(), adapter);

    // Step 1: got transcript
    expect(adapter.getTranscript).toHaveBeenCalledWith("test-session-123");
    // Step 2: called CLI for summary (via execSync)
    expect(execSync).toHaveBeenCalled();
    // Step 3: wrote memory file (write-ahead)
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.renameSync).toHaveBeenCalled();
    // Step 4: compact
    expect(adapter.compact).toHaveBeenCalledWith("test-session-123");
    // Step 5: inject
    expect(adapter.injectMessage).toHaveBeenCalledWith(
      "test-session-123",
      expect.stringContaining("[Context Restored by deslopify]")
    );
  });

  it("throws when transcript is empty", async () => {
    const adapter = makeAdapter({
      getTranscript: vi.fn().mockResolvedValue(""),
    } as any);

    await expect(pipeline.execute(makeSession(), adapter)).rejects.toThrow(
      "No transcript"
    );
  });

  it("continues with fallback summary when CLI summarization fails", async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("CLI not available");
    });

    const adapter = makeAdapter();

    // Should not throw - uses fallback
    await pipeline.execute(makeSession(), adapter);

    // Should still compact and inject
    expect(adapter.compact).toHaveBeenCalled();
    expect(adapter.injectMessage).toHaveBeenCalled();
  });

  it("throws when project path is null", async () => {
    const adapter = makeAdapter({
      getProjectPath: vi.fn().mockResolvedValue(null),
    } as any);

    await expect(pipeline.execute(makeSession(), adapter)).rejects.toThrow(
      "Cannot determine project path"
    );
  });

  it("skips injection when compact fails", async () => {
    const adapter = makeAdapter({
      compact: vi.fn().mockResolvedValue(false),
    } as any);

    // Should not throw
    await pipeline.execute(makeSession(), adapter);

    // Memory should still have been written (write-ahead)
    expect(fs.writeFileSync).toHaveBeenCalled();
    // But injection should NOT be called
    expect(adapter.injectMessage).not.toHaveBeenCalled();
  });

  it("continues pipeline despite memory write failure", async () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("disk full");
    });
    // existsSync returns true for .tmp cleanup
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const adapter = makeAdapter();

    // Pipeline should NOT throw despite memory failure
    await pipeline.execute(makeSession(), adapter);

    // Compact should still be called
    expect(adapter.compact).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("handles injection failure gracefully", async () => {
    const adapter = makeAdapter({
      injectMessage: vi.fn().mockResolvedValue(false),
    } as any);

    // Should not throw
    await pipeline.execute(makeSession(), adapter);

    // Compact should have succeeded
    expect(adapter.compact).toHaveBeenCalled();
  });

  it("injection message contains summary content from CLI", async () => {
    const adapter = makeAdapter();

    await pipeline.execute(makeSession(), adapter);

    const injectCall = (adapter.injectMessage as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const injectedMsg = injectCall[1] as string;

    expect(injectedMsg).toContain("Use TypeScript");
    expect(injectedMsg).toContain("Set up project");
    expect(injectedMsg).toContain("Ship v1");
  });
});
