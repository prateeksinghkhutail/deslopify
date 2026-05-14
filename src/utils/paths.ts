import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

/**
 * Get the home directory for deslopify's own data
 */
export function getDeslopifyHome(): string {
  return path.join(os.homedir(), ".deslopify");
}

/**
 * Get the path to the daemon's unix socket
 */
export function getSocketPath(): string {
  return path.join(getDeslopifyHome(), "daemon.sock");
}

/**
 * Get the path to the daemon's PID file
 */
export function getPidFilePath(): string {
  return path.join(getDeslopifyHome(), "daemon.pid");
}

/**
 * Get the default config file path (~/.deslopify/config.json)
 */
export function getDefaultConfigPath(): string {
  return path.join(getDeslopifyHome(), "config.json");
}

/**
 * Get Claude Code's home directory
 */
export function getClaudeCodeHome(): string {
  return path.join(os.homedir(), ".claude");
}

/**
 * Get Claude Code's settings file path
 */
export function getClaudeCodeSettingsPath(): string {
  return path.join(getClaudeCodeHome(), "settings.json");
}

/**
 * Get Claude Code's sessions directory
 */
export function getClaudeCodeSessionsDir(): string {
  return path.join(getClaudeCodeHome(), "sessions");
}

/**
 * Get Claude Code's projects directory
 */
export function getClaudeCodeProjectsDir(): string {
  return path.join(getClaudeCodeHome(), "projects");
}

/**
 * Encode a project path to Claude Code's directory naming scheme
 * /Users/foo/project -> -Users-foo-project
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * Get OpenCode's database path
 */
export function getOpenCodeDbPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

/**
 * Get OpenCode's session storage directory
 */
export function getOpenCodeStorageDir(): string {
  return path.join(os.homedir(), ".local", "share", "opencode");
}

/**
 * Detect the project root (looks for .git, package.json, etc.)
 */
export function getProjectRoot(): string | null {
  let dir = process.cwd();
  const root = path.parse(dir).root;

  while (dir !== root) {
    const markers = [".git", "package.json", "Cargo.toml", "go.mod", "pyproject.toml"];
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

/**
 * Get the memory file path for a project
 */
export function getMemoryFilePath(projectPath: string, memoryFileName: string): string {
  return path.join(projectPath, memoryFileName);
}
