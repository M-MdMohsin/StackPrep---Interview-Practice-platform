import { z } from 'zod';
import { GeneratedEvaluation } from '../types/ai.types';

const scoreField = z
  .number()
  .int('Score must be an integer')
  .min(0, 'Score must be at least 0')
  .max(10, 'Score must not exceed 10');

const stringArrayField = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Array items cannot be empty')
      .max(200, 'Array items must not exceed 200 characters')
  )
  .max(10, 'Array must not exceed 10 items');

export const evaluationSchema = z.object({
  score: scoreField,
  accuracyScore: scoreField,
  clarityScore: scoreField,
  completenessScore: scoreField,
  relevanceScore: scoreField,
  communicationScore: scoreField,
  strengths: stringArrayField,
  weaknesses: stringArrayField,
  missingConcepts: stringArrayField,
  feedback: z
    .string()
    .trim()
    .min(10, 'Feedback must be at least 10 characters long')
    .max(2000, 'Feedback must not exceed 2000 characters'),
  idealAnswer: z
    .string()
    .trim()
    .min(10, 'Ideal answer must be at least 10 characters long')
    .max(2000, 'Ideal answer must not exceed 2000 characters'),
});

export type EvaluationInput = z.infer<typeof evaluationSchema>;

export function validateEvaluationBusinessRules(parsed: unknown): GeneratedEvaluation {
  return evaluationSchema.parse(parsed);
}
