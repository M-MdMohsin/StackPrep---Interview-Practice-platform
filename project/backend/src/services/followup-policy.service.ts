/**
 * followup-policy.service.ts
 *
 * Pure functions — no DB, no AI, no side effects.
 */
import { FollowUpConfig } from '../config/followup.config';

export type FollowUpReason =
  | 'MISSING_CONCEPTS'
  | 'INCOMPLETE'
  | 'DISABLED'
  | 'DEPTH_LIMIT'
  | 'BUDGET_EXHAUSTED'
  | 'OFF_TOPIC'
  | 'STRONG_ANSWER'
  | 'NOTHING_TO_PROBE'
  | 'GUARDRAIL';

export interface FollowUpDecision {
  followUp: boolean;
  reason: FollowUpReason;
}

export interface DecideFollowUpInput {
  evaluation: {
    score: number;
    completenessScore: number | null;
    relevanceScore: number | null;
    missingConcepts: string[];
  };
  depth: number;
  followUpsUsed: number;
}

/**
 * Decides whether to generate a follow-up question.
 * Check order (spec-mandated):
 *   1. disabled
 *   2. depth >= maxDepth
 *   3. followUpsUsed >= maxPerInterview
 *   4. relevanceScore < minRelevance
 *   5. score >= strongScore
 *   6. missingConcepts non-empty -> MISSING_CONCEPTS
 *   7. completenessScore <= incompleteThreshold -> INCOMPLETE
 *   8. else NOTHING_TO_PROBE
 */
export function decideFollowUp(
  input: DecideFollowUpInput,
  config: FollowUpConfig,
): FollowUpDecision {
  const { evaluation, depth, followUpsUsed } = input;

  if (!config.enabled) return { followUp: false, reason: 'DISABLED' };
  if (depth >= config.maxDepth) return { followUp: false, reason: 'DEPTH_LIMIT' };
  if (followUpsUsed >= config.maxPerInterview) return { followUp: false, reason: 'BUDGET_EXHAUSTED' };

  // Treat null relevanceScore conservatively (don't block on missing data)
  const relevanceScore = evaluation.relevanceScore ?? config.minRelevance;
  if (relevanceScore < config.minRelevance) return { followUp: false, reason: 'OFF_TOPIC' };

  if (evaluation.score >= config.strongScore) return { followUp: false, reason: 'STRONG_ANSWER' };

  if (evaluation.missingConcepts.length > 0) return { followUp: true, reason: 'MISSING_CONCEPTS' };

  const completenessScore = evaluation.completenessScore ?? (config.incompleteThreshold + 1);
  if (completenessScore <= config.incompleteThreshold) return { followUp: true, reason: 'INCOMPLETE' };

  return { followUp: false, reason: 'NOTHING_TO_PROBE' };
}

export interface QuestionNode {
  id: string;
  parentQuestionId: string | null;
}

/**
 * Returns the depth of a question: number of parent hops from this question
 * back to a top-level question. Top-level questions return 0.
 * Loop guard: max 100 hops to prevent infinite cycles from malformed data.
 */
export function getQuestionDepth(
  question: QuestionNode,
  questionsById: Map<string, QuestionNode>,
): number {
  const MAX_HOPS = 100;
  let depth = 0;
  let current: QuestionNode | undefined = question;
  const visited = new Set<string>();

  while (current && current.parentQuestionId !== null) {
    if (visited.has(current.id)) break; // loop guard
    visited.add(current.id);
    depth++;
    if (depth >= MAX_HOPS) break;
    current = questionsById.get(current.parentQuestionId) ?? undefined;
  }
  return depth;
}
