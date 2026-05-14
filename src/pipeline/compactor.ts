import type { DeslopifyConfig, SessionInfo } from "../config/loader.js";
import type { BaseAdapter } from "../adapters/base.js";
import { Summarizer, type Summary } from "./summarizer.js";
import { MemoryWriter } from "./memory-writer.js";
import { Injector } from "./injector.js";
import { logger } from "../utils/logger.js";

/**
 * The compaction pipeline orchestrates the full process:
 * 1. Get transcript
 * 2. Summarize (write-ahead: save memory BEFORE compact)
 * 3. Write to project-memory.md
 * 4. Execute /compact
 * 5. Inject summary into new context
 */
export class CompactionPipeline {
  private config: DeslopifyConfig;
  private summarizer: Summarizer;
  private memoryWriter: MemoryWriter;
  private injector: Injector;

  constructor(config: DeslopifyConfig) {
    this.config = config;
    this.summarizer = new Summarizer(config);
    this.memoryWriter = new MemoryWriter(config);
    this.injector = new Injector(config);
  }

  /**
   * Execute the full compaction pipeline for a session
   */
  async execute(session: SessionInfo, adapter: BaseAdapter): Promise<void> {
    const { id, cli, model, tokensUsed } = session;
    logger.info(`Starting compaction pipeline for session ${id}`, {
      cli,
      model,
      tokensUsed,
      percentUsed: `${(session.percentUsed * 100).toFixed(1)}%`,
    });

    // Step 1: Get transcript
    logger.info(`[1/5] Getting transcript for session ${id}`);
    const transcript = await adapter.getTranscript(id);
    if (!transcript) {
      throw new Error(`No transcript available for session ${id}`);
    }

    // Step 2: Summarize
    logger.info(`[2/5] Summarizing session ${id}`);
    let summary: Summary;
    try {
      summary = await this.summarizer.summarize(
        transcript,
        id,
        model,
        tokensUsed,
        cli
      );
    } catch (err) {
      logger.error("Summarization failed", { error: String(err) });
      // Create a minimal fallback summary
      summary = {
        decisions: [],
        completedTasks: [],
        openIssues: ["Summarization failed - manual review recommended"],
        currentGoals: [],
        rawSummary: "Summarization failed",
        timestamp: Date.now(),
        sessionId: id,
        model,
        tokensAtCompaction: tokensUsed,
      };
    }

    // Step 3: Write to memory file (WRITE-AHEAD - before compact!)
    logger.info(`[3/5] Writing memory (write-ahead) for session ${id}`);
    const projectPath = await adapter.getProjectPath(id);
    if (!projectPath) {
      throw new Error(`Cannot determine project path for session ${id}`);
    }

    try {
      await this.memoryWriter.write(summary, projectPath);
    } catch (err) {
      // Memory write failure is critical - notify but don't abort
      logger.error("CRITICAL: Memory write failed!", { error: String(err) });
      this.notifyUser(
        `[deslopify] WARNING: Failed to save memory for session ${id}. ` +
          `Context will be compacted but memory may be lost. Error: ${err}`
      );
    }

    // Step 4: Execute /compact
    logger.info(`[4/5] Executing compact for session ${id}`);
    const compactSuccess = await adapter.compact(id);
    if (!compactSuccess) {
      logger.warn(`Compact command failed for session ${id} - memory was saved`);
      this.notifyUser(
        `[deslopify] Compact failed for session ${id}. ` +
          `Memory has been saved to ${this.config.memoryFile}. ` +
          `You may need to run /compact manually.`
      );
      return; // Don't inject if compact failed
    }

    // Step 5: Inject summary as first message in new context
    logger.info(`[5/5] Injecting summary into session ${id}`);
    const injectionMessage = this.injector.buildInjectionMessage(summary);
    const injectSuccess = await adapter.injectMessage(id, injectionMessage);

    if (!injectSuccess) {
      logger.warn("Summary injection failed - user will need to reference memory file manually");
    }

    logger.info(`Compaction pipeline complete for session ${id}`, {
      summaryLength: summary.rawSummary.length,
      decisions: summary.decisions.length,
      completedTasks: summary.completedTasks.length,
      openIssues: summary.openIssues.length,
      currentGoals: summary.currentGoals.length,
    });
  }

  private notifyUser(message: string): void {
    // Log prominently - this is a user-facing notification
    console.log(`\n${"=".repeat(60)}`);
    console.log(message);
    console.log(`${"=".repeat(60)}\n`);
  }
}

export { Compactor } from "./compact-executor.js";
