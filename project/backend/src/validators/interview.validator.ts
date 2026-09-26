import { z } from 'zod';

export const EXPERIENCE_LEVELS = ['JUNIOR', 'MID', 'SENIOR', 'LEAD'] as const;
export const INTERVIEW_TYPES = ['TECHNICAL', 'BEHAVIORAL', 'SYSTEM_DESIGN', 'MIXED'] as const;
export const DIFFICULTY_LEVELS = ['EASY', 'MEDIUM', 'HARD'] as const;

export const createInterviewSchema = z.object({
  role: z.string().min(1, 'Role is required').max(100, 'Role must be 100 characters or fewer'),
  experienceLevel: z.enum(EXPERIENCE_LEVELS, {
    message: `Experience level must be one of: ${EXPERIENCE_LEVELS.join(', ')}`,
  }),
  interviewType: z.enum(INTERVIEW_TYPES, {
    message: `Interview type must be one of: ${INTERVIEW_TYPES.join(', ')}`,
  }),
  difficulty: z.enum(DIFFICULTY_LEVELS, {
    message: `Difficulty must be one of: ${DIFFICULTY_LEVELS.join(', ')}`,
  }),
  questionLimit: z
    .number()
    .int('Question limit must be an integer')
    .min(1, 'Question limit must be at least 1')
    .max(20, 'Question limit cannot exceed 20')
    .default(5),
  resumeId: z.string().uuid('Resume ID must be a valid UUID').optional(),
});

export type CreateInterviewInput = z.infer<typeof createInterviewSchema>;
