import * as fs from "node:fs";
import * as path from "node:path";
import { getDefaultConfigPath, getProjectRoot } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

export type AdapterType = "claude-code" | "opencode";

export interface DeslopifyConfig {
  threshold: number;
  memoryFile: string;
  pollInterval: number;
  adapters: AdapterType[];
  summarization: {
    provider: "same-cli" | "api" | "ollama";
    maxSummaryTokens: number;
    prompt: string;
  };
  injection: {
    method: "first-message" | "file-reference" | "claude-md";
    maxInjectTokens: number;
  };
  idle: {
    waitMs: number;
    maxWaitMs: number;
    checkInterval: number;
  };
  models: Record<string, number>;
}

export interface SessionInfo {
  id: string;
  cli: AdapterType;
  projectPath: string;
  model: string;
  tokensUsed: number;
  maxTokens: number;
  percentUsed: number;
  status: "active" | "idle" | "compacting" | "unknown";
  lastActivity: number;
}

const DEFAULT_CONFIG: DeslopifyConfig = {
  threshold: 0.4,
  memoryFile: "project-memory.md",
  pollInterval: 5000,
  adapters: ["claude-code", "opencode"],
  summarization: {
    provider: "same-cli",
    maxSummaryTokens: 2000,
    prompt:
      "Summarize this conversation transcript. Extract: 1) Key architectural decisions made, 2) Tasks completed, 3) Open bugs/issues, 4) Current goals and next steps. Be concise and structured.",
  },
  injection: {
    method: "first-message",
    maxInjectTokens: 1500,
  },
  idle: {
    waitMs: 3000,
    maxWaitMs: 30000,
    checkInterval: 1000,
  },
  models: {
    "claude-sonnet-4-20250514": 200000,
    "claude-opus-4-20250514": 200000,
    "claude-haiku-3-20250414": 200000,
    "claude-3-5-sonnet-20241022": 200000,
    "claude-3-5-haiku-20241022": 200000,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
    "o1": 200000,
    "o1-mini": 128000,
  },
};

export function loadConfig(configPath?: string): DeslopifyConfig {
  const resolvedPath = configPath || findConfigFile();

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    logger.info("No config file found, using defaults");
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    const userConfig = JSON.parse(raw);
    const merged = deepMerge(DEFAULT_CONFIG, userConfig);
    logger.info(`Loaded config from ${resolvedPath}`);
    return merged as DeslopifyConfig;
  } catch (err) {
    logger.warn(`Failed to parse config at ${resolvedPath}, using defaults`);
    return { ...DEFAULT_CONFIG };
  }
}

function findConfigFile(): string | null {
  // Search order: project root > home dir > XDG config
  const candidates = [
    path.join(process.cwd(), "deslopify.config.json"),
    path.join(getProjectRoot() || process.cwd(), "deslopify.config.json"),
    getDefaultConfigPath(),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (key === "$schema") continue;
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function getModelMaxTokens(
  model: string,
  config: DeslopifyConfig
): number {
  // Handle JSON-encoded model objects (OpenCode stores model as JSON)
  let modelId = model;
  try {
    const parsed = JSON.parse(model);
    if (parsed && typeof parsed === "object" && parsed.id) {
      modelId = parsed.id;
    }
  } catch {
    // Not JSON, use as-is
  }

  // Exact match
  if (config.models[modelId]) return config.models[modelId];

  // Partial match (e.g., "claude-sonnet-4" matches "claude-sonnet-4-20250514")
  for (const [key, value] of Object.entries(config.models)) {
    if (modelId.includes(key) || key.includes(modelId)) return value;
  }

  // Default fallback based on prefix
  if (modelId.startsWith("claude")) return 200000;
  if (modelId.startsWith("gpt-4")) return 128000;
  if (modelId.startsWith("o1")) return 200000;
  if (modelId.startsWith("gemma")) return 128000;

  return 200000;
}
