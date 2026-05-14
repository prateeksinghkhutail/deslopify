import type { SessionInfo, AdapterType, DeslopifyConfig } from "../config/loader.js";

/**
 * Base interface for CLI adapters.
 * Each adapter knows how to read session data from a specific CLI.
 */
export interface BaseAdapter {
  readonly name: AdapterType;

  /**
   * Check if this CLI is installed and accessible
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get all active sessions for this CLI
   */
  getActiveSessions(): Promise<SessionInfo[]>;

  /**
   * Get token usage for a specific session
   */
  getTokenUsage(sessionId: string): Promise<{ used: number; model: string } | null>;

  /**
   * Check if a session is currently idle (no active tool calls)
   */
  isIdle(sessionId: string): Promise<boolean>;

  /**
   * Get the raw transcript text for summarization
   */
  getTranscript(sessionId: string): Promise<string>;

  /**
   * Execute the compact command for this CLI's session
   */
  compact(sessionId: string): Promise<boolean>;

  /**
   * Inject a message into the session (post-compact context restoration)
   */
  injectMessage(sessionId: string, message: string): Promise<boolean>;

  /**
   * Get the project path associated with a session
   */
  getProjectPath(sessionId: string): Promise<string | null>;

  /**
   * Install hooks/plugins for this adapter
   */
  install(): Promise<void>;

  /**
   * Remove hooks/plugins for this adapter
   */
  uninstall(): Promise<void>;
}

/**
 * Session data extracted from transcript for summarization
 */
export interface TranscriptData {
  messages: TranscriptMessage[];
  totalTokens: number;
  model: string;
  projectPath: string;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  tokenCount?: number;
}
