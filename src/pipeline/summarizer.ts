import { execSync } from "node:child_process";
import type { DeslopifyConfig } from "../config/loader.js";
import type { BaseAdapter } from "../adapters/base.js";
import { logger } from "../utils/logger.js";

export interface Summary {
  decisions: string[];
  completedTasks: string[];
  openIssues: string[];
  currentGoals: string[];
  rawSummary: string;
  timestamp: number;
  sessionId: string;
  model: string;
  tokensAtCompaction: number;
}

export class Summarizer {
  private config: DeslopifyConfig;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  /**
   * Generate a structured summary of the session transcript
   */
  async summarize(
    transcript: string,
    sessionId: string,
    model: string,
    tokensUsed: number,
    cli: "claude-code" | "opencode"
  ): Promise<Summary> {
    logger.info(`Summarizing session ${sessionId} via ${cli}`);

    const prompt = this.buildPrompt(transcript);
    let rawSummary: string;

    try {
      rawSummary = await this.callCli(prompt, cli);
    } catch (err) {
      logger.error("Summarization failed, using fallback", { error: String(err) });
      rawSummary = this.fallbackSummary(transcript);
    }

    // Parse the structured summary
    const parsed = this.parseSummary(rawSummary);

    return {
      ...parsed,
      rawSummary,
      timestamp: Date.now(),
      sessionId,
      model,
      tokensAtCompaction: tokensUsed,
    };
  }

  private buildPrompt(transcript: string): string {
    // Truncate transcript if too long (keep last ~30k chars for summarization)
    const maxChars = 30000;
    const trimmedTranscript =
      transcript.length > maxChars
        ? "...[earlier conversation truncated]...\n\n" +
          transcript.slice(-maxChars)
        : transcript;

    return `${this.config.summarization.prompt}

Format your response EXACTLY as follows (use these exact headers):

## Architectural Decisions
- [decision 1]
- [decision 2]

## Completed Tasks
- [task 1]
- [task 2]

## Open Issues
- [issue 1]
- [issue 2]

## Current Goals
- [goal 1]
- [goal 2]

Here is the conversation transcript to summarize:

---
${trimmedTranscript}
---`;
  }

  private async callCli(
    prompt: string,
    cli: "claude-code" | "opencode"
  ): Promise<string> {
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    let command: string;
    if (cli === "claude-code") {
      command = `claude --print '${escapedPrompt}'`;
    } else {
      command = `opencode run '${escapedPrompt}'`;
    }

    try {
      const result = execSync(command, {
        encoding: "utf-8",
        timeout: 120000, // 2 minute timeout
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim();
    } catch (err: any) {
      // Try to get output even on non-zero exit
      if (err.stdout) return err.stdout.trim();
      throw err;
    }
  }

  private parseSummary(raw: string): {
    decisions: string[];
    completedTasks: string[];
    openIssues: string[];
    currentGoals: string[];
  } {
    const sections = {
      decisions: this.extractSection(raw, "Architectural Decisions"),
      completedTasks: this.extractSection(raw, "Completed Tasks"),
      openIssues: this.extractSection(raw, "Open Issues"),
      currentGoals: this.extractSection(raw, "Current Goals"),
    };

    return sections;
  }

  private extractSection(text: string, header: string): string[] {
    const regex = new RegExp(
      `##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`,
      "i"
    );
    const match = text.match(regex);
    if (!match) return [];

    return match[1]
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);
  }

  /**
   * Fallback summary when CLI call fails - extract key information heuristically
   */
  private fallbackSummary(transcript: string): string {
    const lines = transcript.split("\n");
    const userMessages = lines
      .filter((l) => l.startsWith("USER:"))
      .slice(-10)
      .map((l) => l.replace("USER:", "").trim());

    return `## Architectural Decisions
- Unable to generate AI summary (CLI unavailable)

## Completed Tasks
- Session was active with ${lines.length} messages

## Open Issues
- Context was compacted automatically at threshold

## Current Goals
${userMessages.slice(-3).map((m) => `- ${m.slice(0, 100)}`).join("\n")}`;
  }
}
