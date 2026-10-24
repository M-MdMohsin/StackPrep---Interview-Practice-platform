/**
 * interview-state.service.ts
 *
 * Pure functions — no DB access, no side effects.
 * Input questions must have the shape below; sort order is irrelevant.
 */

export interface QuestionState {
  id: string;
  orderIndex: number;
  parentQuestionId: string | null;
  answer: {
    id: string;
    evaluation: { id: string } | null;
  } | null;
}

/**
 * A question is COMPLETE when it has an Evaluation.
 * The PENDING question is the highest-orderIndex question (top-level OR
 * follow-up) that is NOT complete. It may be unanswered, or
 * answered-but-awaiting-evaluation.
 * Returns null when every question is complete, or the list is empty.
 */
export function getPendingQuestion(questions: QuestionState[]): QuestionState | null {
  // Sort descending by orderIndex so we pick the highest-order incomplete one
  const sorted = [...questions].sort((a, b) => b.orderIndex - a.orderIndex);
  for (const q of sorted) {
    const isComplete = q.answer !== null && q.answer.evaluation !== null;
    if (!isComplete) return q;
  }
  return null;
}

/**
 * Returns the highest-orderIndex question that IS complete, or null.
 */
export function getLastCompletedQuestion(questions: QuestionState[]): QuestionState | null {
  const sorted = [...questions].sort((a, b) => b.orderIndex - a.orderIndex);
  for (const q of sorted) {
    const isComplete = q.answer !== null && q.answer.evaluation !== null;
    if (isComplete) return q;
  }
  return null;
}

/**
 * Returns the count of top-level questions (parentQuestionId === null).
 */
export function countTopLevel(questions: QuestionState[]): number {
  return questions.filter((q) => q.parentQuestionId === null).length;
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
