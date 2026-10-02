import { z } from 'zod';

export const paramsSchema = z.object({
  questionId: z.string().uuid('Question ID must be a valid UUID'),
});

export const bodySchema = z.object({
  answerText: z
    .string()
    .refine((val) => val.trim().length > 0, {
      message: 'Answer text cannot be empty or contain only whitespace',
    })
    .transform((val) => val.trim())
    .pipe(
      z
        .string()
        .min(10, 'Answer text must be at least 10 characters long')
        .max(5000, 'Answer text must not exceed 5000 characters')
    ),
});

export const answerParamsSchema = paramsSchema;
export const answerBodySchema = bodySchema;

export type AnswerParamsInput = z.infer<typeof paramsSchema>;
export type AnswerBodyInput = z.infer<typeof bodySchema>;
