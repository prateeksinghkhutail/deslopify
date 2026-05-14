import type { BaseAdapter } from "../adapters/base.js";
import { logger } from "../utils/logger.js";

/**
 * Standalone compact executor - triggers the CLI's native compact command
 */
export class Compactor {
  /**
   * Execute compact for a session
   */
  async execute(sessionId: string, adapter: BaseAdapter): Promise<boolean> {
    logger.info(`Executing compact for session ${sessionId}`);

    try {
      const success = await adapter.compact(sessionId);
      if (success) {
        logger.info(`Compact successful for session ${sessionId}`);
      } else {
        logger.warn(`Compact returned false for session ${sessionId}`);
      }
      return success;
    } catch (err) {
      logger.error(`Compact threw error for session ${sessionId}`, {
        error: String(err),
      });
      return false;
    }
  }
}
