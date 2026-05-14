import type { DeslopifyConfig, SessionInfo } from "../config/loader.js";
import { getModelMaxTokens } from "../config/loader.js";
import type { BaseAdapter } from "../adapters/base.js";
import { logger } from "../utils/logger.js";

export interface ContextStatus {
  sessionId: string;
  tokensUsed: number;
  maxTokens: number;
  percentUsed: number;
  thresholdHit: boolean;
  model: string;
}

export class ContextTracker {
  private config: DeslopifyConfig;
  private sessionHistory: Map<string, number[]> = new Map(); // Track token growth

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  /**
   * Check if a session has hit the compaction threshold
   */
  async check(session: SessionInfo): Promise<ContextStatus> {
    const { tokensUsed, maxTokens, model, id } = session;
    const percentUsed = maxTokens > 0 ? tokensUsed / maxTokens : 0;
    const thresholdHit = percentUsed >= this.config.threshold;

    // Track token growth for logging/debugging
    const history = this.sessionHistory.get(id) || [];
    history.push(tokensUsed);
    if (history.length > 100) history.shift(); // Keep last 100 data points
    this.sessionHistory.set(id, history);

    if (thresholdHit) {
      logger.info(`Threshold hit for session ${id}`, {
        tokensUsed,
        maxTokens,
        percentUsed: `${(percentUsed * 100).toFixed(1)}%`,
        threshold: `${(this.config.threshold * 100).toFixed(0)}%`,
      });
    }

    return {
      sessionId: id,
      tokensUsed,
      maxTokens,
      percentUsed,
      thresholdHit,
      model,
    };
  }

  /**
   * Get current status for a session from an adapter
   */
  async getStatus(
    sessionId: string,
    adapter: BaseAdapter
  ): Promise<ContextStatus | null> {
    const usage = await adapter.getTokenUsage(sessionId);
    if (!usage) return null;

    const maxTokens = getModelMaxTokens(usage.model, this.config);
    const percentUsed = maxTokens > 0 ? usage.used / maxTokens : 0;

    return {
      sessionId,
      tokensUsed: usage.used,
      maxTokens,
      percentUsed,
      thresholdHit: percentUsed >= this.config.threshold,
      model: usage.model,
    };
  }

  /**
   * Get the token growth rate (tokens per minute) for a session
   */
  getGrowthRate(sessionId: string): number | null {
    const history = this.sessionHistory.get(sessionId);
    if (!history || history.length < 2) return null;

    const recent = history.slice(-10);
    const growth = recent[recent.length - 1] - recent[0];
    const timeSpan = (recent.length - 1) * (this.config.pollInterval / 1000 / 60);
    return timeSpan > 0 ? growth / timeSpan : 0;
  }

  /**
   * Estimate time until threshold hit (in minutes)
   */
  estimateTimeToThreshold(sessionId: string, session: SessionInfo): number | null {
    const growthRate = this.getGrowthRate(sessionId);
    if (!growthRate || growthRate <= 0) return null;

    const tokensRemaining =
      session.maxTokens * this.config.threshold - session.tokensUsed;
    if (tokensRemaining <= 0) return 0;

    return tokensRemaining / growthRate;
  }

  /**
   * Clear tracking data for a session (after compaction)
   */
  reset(sessionId: string): void {
    this.sessionHistory.delete(sessionId);
  }
}
