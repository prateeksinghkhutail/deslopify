import type { DeslopifyConfig } from "../config/loader.js";
import type { Summary } from "./summarizer.js";
import { logger } from "../utils/logger.js";

/**
 * Injector builds and sends the context restoration message
 * after compaction completes.
 */
export class Injector {
  private config: DeslopifyConfig;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  /**
   * Build the message to inject as the first message after compact.
   * This gives the AI the essential context it needs to continue.
   */
  buildInjectionMessage(summary: Summary): string {
    const parts: string[] = [];

    parts.push(
      "**[Context Restored by deslopify]** The previous context was automatically compacted. Here's what happened before:"
    );
    parts.push("");

    if (summary.decisions.length > 0) {
      parts.push("**Key Decisions:**");
      for (const decision of summary.decisions.slice(0, 5)) {
        parts.push(`- ${decision}`);
      }
      parts.push("");
    }

    if (summary.completedTasks.length > 0) {
      parts.push("**Completed:**");
      for (const task of summary.completedTasks.slice(0, 5)) {
        parts.push(`- ${task}`);
      }
      parts.push("");
    }

    if (summary.openIssues.length > 0) {
      parts.push("**Open Issues:**");
      for (const issue of summary.openIssues.slice(0, 3)) {
        parts.push(`- ${issue}`);
      }
      parts.push("");
    }

    if (summary.currentGoals.length > 0) {
      parts.push("**Current Goals (continue from here):**");
      for (const goal of summary.currentGoals) {
        parts.push(`- ${goal}`);
      }
      parts.push("");
    }

    parts.push(
      `_Full history saved to \`${summary.sessionId.slice(0, 8)}...\` in project-memory.md_`
    );

    return parts.join("\n");
  }

  /**
   * Truncate the injection message to stay within token budget
   */
  truncateToTokenBudget(message: string): string {
    const maxChars = this.config.injection.maxInjectTokens * 4; // ~4 chars per token
    if (message.length <= maxChars) return message;

    logger.debug("Truncating injection message to fit token budget");
    return message.slice(0, maxChars) + "\n\n_[message truncated to fit token budget]_";
  }
}
