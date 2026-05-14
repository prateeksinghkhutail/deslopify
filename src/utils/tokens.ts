/**
 * Lightweight token estimation using heuristics.
 * No external dependencies required.
 */

/**
 * Estimate token count from text using heuristic.
 * Based on the observation that ~4 characters = 1 token for English/code.
 */
export function countTokens(text: string): number {
  return estimateTokens(text);
}

/**
 * Fast heuristic token estimation (no dependencies)
 * ~4 chars per token for English, ~3 for code
 */
export function estimateTokens(text: string): number {
  // Rough heuristic: split on whitespace and punctuation
  const words = text.split(/\s+/).length;
  const chars = text.length;

  // Use a blend: average of word-based and char-based estimates
  const wordEstimate = words * 1.3; // avg 1.3 tokens per word
  const charEstimate = chars / 3.5; // avg 3.5 chars per token

  return Math.round((wordEstimate + charEstimate) / 2);
}

/**
 * Calculate percentage of context used
 */
export function calculateUsagePercent(tokensUsed: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return tokensUsed / maxTokens;
}

/**
 * Format token count for display
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return tokens.toString();
}
