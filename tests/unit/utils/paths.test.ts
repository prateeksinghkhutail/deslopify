import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

import * as fs from "node:fs";
import {
  getDeslopifyHome,
  getSocketPath,
  getPidFilePath,
  getDefaultConfigPath,
  getClaudeCodeHome,
  getClaudeCodeSettingsPath,
  getClaudeCodeSessionsDir,
  getClaudeCodeProjectsDir,
  encodeProjectPath,
  getOpenCodeDbPath,
  getOpenCodeStorageDir,
  getProjectRoot,
  ensureDir,
  getMemoryFilePath,
} from "../../../src/utils/paths.js";

describe("path helpers", () => {
  it("getDeslopifyHome returns ~/.deslopify", () => {
    expect(getDeslopifyHome()).toBe("/home/testuser/.deslopify");
  });

  it("getSocketPath returns daemon.sock inside home", () => {
    expect(getSocketPath()).toContain("daemon.sock");
    expect(getSocketPath()).toContain(".deslopify");
  });

  it("getPidFilePath returns daemon.pid inside home", () => {
    expect(getPidFilePath()).toContain("daemon.pid");
  });

  it("getDefaultConfigPath returns config.json inside home", () => {
    expect(getDefaultConfigPath()).toContain("config.json");
    expect(getDefaultConfigPath()).toContain(".deslopify");
  });

  it("getClaudeCodeHome returns ~/.claude", () => {
    expect(getClaudeCodeHome()).toBe("/home/testuser/.claude");
  });

  it("getClaudeCodeSettingsPath returns settings.json", () => {
    expect(getClaudeCodeSettingsPath()).toContain(".claude");
    expect(getClaudeCodeSettingsPath()).toContain("settings.json");
  });

  it("getClaudeCodeSessionsDir returns sessions dir", () => {
    expect(getClaudeCodeSessionsDir()).toContain("sessions");
  });

  it("getClaudeCodeProjectsDir returns projects dir", () => {
    expect(getClaudeCodeProjectsDir()).toContain("projects");
  });

  it("getOpenCodeDbPath returns correct path", () => {
    expect(getOpenCodeDbPath()).toContain("opencode.db");
    expect(getOpenCodeDbPath()).toContain(".local");
  });

  it("getOpenCodeStorageDir returns storage dir", () => {
    expect(getOpenCodeStorageDir()).toContain("opencode");
  });
});

describe("encodeProjectPath", () => {
  it("replaces slashes with dashes", () => {
    expect(encodeProjectPath("/Users/foo/project")).toBe("-Users-foo-project");
  });

  it("handles root path", () => {
    expect(encodeProjectPath("/")).toBe("-");
  });

  it("handles path with no slashes", () => {
    expect(encodeProjectPath("project")).toBe("project");
  });
});

describe("getProjectRoot", () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("returns null when no marker found", () => {
    expect(getProjectRoot()).toBeNull();
  });
});

describe("ensureDir", () => {
  it("calls mkdirSync with recursive option", () => {
    ensureDir("/some/nested/dir");
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith("/some/nested/dir", {
      recursive: true,
    });
  });
});

describe("getMemoryFilePath", () => {
  it("joins project path and filename", () => {
    const result = getMemoryFilePath("/home/user/project", "project-memory.md");
    expect(result).toContain("project");
    expect(result).toContain("project-memory.md");
  });
});
