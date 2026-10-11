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
