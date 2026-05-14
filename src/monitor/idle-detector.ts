import type { DeslopifyConfig } from "../config/loader.js";
import type { BaseAdapter } from "../adapters/base.js";
import { logger } from "../utils/logger.js";

export class IdleDetector {
  private config: DeslopifyConfig;

  constructor(config: DeslopifyConfig) {
    this.config = config;
  }

  /**
   * Wait for a session to become idle before proceeding with compaction.
   * Returns true if session became idle within maxWaitMs, false if timed out.
   */
  async waitForIdle(sessionId: string, adapter: BaseAdapter): Promise<boolean> {
    const { waitMs, maxWaitMs, checkInterval } = this.config.idle;
    const startTime = Date.now();
    let consecutiveIdleChecks = 0;
    const requiredIdleChecks = Math.ceil(waitMs / checkInterval);

    logger.debug(`Waiting for session ${sessionId} to become idle`, {
      waitMs,
      maxWaitMs,
      checkInterval,
      requiredIdleChecks,
    });

    while (Date.now() - startTime < maxWaitMs) {
      const isIdle = await adapter.isIdle(sessionId);

      if (isIdle) {
        consecutiveIdleChecks++;
        if (consecutiveIdleChecks >= requiredIdleChecks) {
          logger.debug(`Session ${sessionId} confirmed idle after ${consecutiveIdleChecks} checks`);
          return true;
        }
      } else {
        consecutiveIdleChecks = 0;
      }

      await this.sleep(checkInterval);
    }

    logger.warn(`Session ${sessionId} did not become idle within ${maxWaitMs}ms`);
    return false;
  }

  /**
   * Quick check - is the session idle right now?
   */
  async isCurrentlyIdle(sessionId: string, adapter: BaseAdapter): Promise<boolean> {
    return adapter.isIdle(sessionId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
