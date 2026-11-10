import { z } from 'zod';
import { ResumeAnalysisResult } from '../types/ai.types';

// Email pattern
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;

// Phone pattern (handles international + country code, standard 10-digit US, 7-digit with country code, etc.)
const PHONE_REGEX = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|(?:\+\d{1,3}[-.\s]?)?\d{3}[-.\s]?\d{4}\b|\b\d{10,15}\b/;

export const CAPS = {
  skills: 50,
  technologies: 60,
  projects: 15,
  experience: 15,
  education: 10,
} as const;

/**
 * Cleans a list of string items according to Step 10 Part 2 rules:
 * - ensures array and string values
 * - trims whitespace
 * - drops empty strings
 * - removes any item matching an email or phone pattern
 * - truncates items to 300 chars max
 * - case-insensitive deduplication (preserves first occurrence)
 * - truncates list to cap
 */
export function cleanStringList(items: unknown, maxCap: number): string[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of items) {
    if (typeof raw !== 'string') continue;
    let item = raw.trim();
    if (item.length === 0) continue;

    // Remove any item matching email or phone pattern
    if (EMAIL_REGEX.test(item) || PHONE_REGEX.test(item)) {
      continue;
    }

    // Items 1-300 chars
    if (item.length > 300) {
      item = item.slice(0, 300);
    }

    // Case-insensitive dedupe
    const lower = item.toLowerCase();
    if (seen.has(lower)) {
      continue;
    }
    seen.add(lower);

    result.push(item);

    if (result.length >= maxCap) {
      break;
    }
  }

  return result;
}

/**
 * Zod schema for validated resume analysis output.
 * Validates, cleans, and applies business rules:
 * - trim, drop empties
 * - case-insensitive dedupe
 * - items 1-300 chars
 * - truncate to caps (skills 50, technologies 60, projects 15, experience 15, education 10)
 * - remove any item matching an email or phone pattern
 * - Invalid if skills, technologies, experience, and projects are ALL empty after cleaning
 */
export const resumeAnalysisSchema = z.any().transform((val, ctx) => {
  if (!val || typeof val !== 'object') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resume analysis output must be a valid JSON object',
    });
    return z.NEVER;
  }

  const obj = val as Record<string, unknown>;
  const skills = cleanStringList(obj.skills, CAPS.skills);
  const technologies = cleanStringList(obj.technologies, CAPS.technologies);
  const projects = cleanStringList(obj.projects, CAPS.projects);
  const experience = cleanStringList(obj.experience, CAPS.experience);
  const education = cleanStringList(obj.education, CAPS.education);

  // Invalid if skills, technologies, experience and projects are ALL empty after cleaning
  if (
    skills.length === 0 &&
    technologies.length === 0 &&
    experience.length === 0 &&
    projects.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Resume analysis must contain at least one skill, technology, project, or experience entry',
    });
    return z.NEVER;
  }

  const result: ResumeAnalysisResult = {
    skills,
    technologies,
    projects,
    experience,
    education,
  };

  return result;
});

export type ValidatedResumeAnalysis = z.infer<typeof resumeAnalysisSchema>;
