import { z } from 'zod';
import { DIFFICULTY_LEVELS } from './interview.validator';

export const questionParamsSchema = z.object({
  id: z.string().uuid('Interview ID must be a valid UUID'),
});

export const generatedQuestionSchema = z.object({
  questionText: z.string().trim().min(15).max(1000),
  topic: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(100),
  questionType: z.string().trim().min(1).max(50),
  difficulty: z.string().transform((val) => val.toUpperCase()).pipe(
    z.enum(DIFFICULTY_LEVELS)
  ),
});

export type GeneratedQuestionInput = z.infer<typeof generatedQuestionSchema>;
