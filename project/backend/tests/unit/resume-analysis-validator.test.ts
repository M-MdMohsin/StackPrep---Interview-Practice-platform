import { describe, it, expect } from 'vitest';
import {
  resumeAnalysisSchema,
  cleanStringList,
  CAPS,
} from '../../src/validators/resume-analysis.validator';

describe('resume-analysis.validator', () => {
  describe('cleanStringList', () => {
    it('trims whitespace and drops empty strings', () => {
      const input = ['  TypeScript  ', '', '   ', 'Node.js'];
      const result = cleanStringList(input, 10);
      expect(result).toEqual(['TypeScript', 'Node.js']);
    });

    it('performs case-insensitive deduplication preserving first occurrence', () => {
      const input = ['TypeScript', 'typescript', 'TYPESCRIPT', 'Docker', 'docker'];
      const result = cleanStringList(input, 10);
      expect(result).toEqual(['TypeScript', 'Docker']);
    });

    it('truncates items longer than 300 characters to 300 chars', () => {
      const longItem = 'A'.repeat(350);
      const result = cleanStringList([longItem], 10);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(300);
      expect(result[0]).toBe('A'.repeat(300));
    });

    it('removes items matching email patterns', () => {
      const input = [
        'john.doe@example.com',
        'Email: candidate@domain.org',
        'TypeScript',
        'Docker',
      ];
      const result = cleanStringList(input, 10);
      expect(result).toEqual(['TypeScript', 'Docker']);
    });

    it('removes items matching phone patterns while keeping legitimate dates/versions', () => {
      const input = [
        '+1-555-0199',
        '(555) 123-4567',
        '555-123-4567',
        '+44 20 7946 0958',
        '1234567890',
        'Node.js 20.0', // version - keep
        'Software Engineer (2018 - 2022)', // date range - keep
        'PostgreSQL',
      ];
      const result = cleanStringList(input, 10);
      expect(result).toContain('Node.js 20.0');
      expect(result).toContain('Software Engineer (2018 - 2022)');
      expect(result).toContain('PostgreSQL');
      expect(result).not.toContain('+1-555-0199');
      expect(result).not.toContain('(555) 123-4567');
      expect(result).not.toContain('555-123-4567');
      expect(result).not.toContain('1234567890');
    });

    it('enforces maximum item caps', () => {
      const manyItems = Array.from({ length: 100 }, (_, i) => `Item ${i}`);
      const result = cleanStringList(manyItems, CAPS.skills);
      expect(result).toHaveLength(CAPS.skills);
      expect(result[0]).toBe('Item 0');
      expect(result[CAPS.skills - 1]).toBe(`Item ${CAPS.skills - 1}`);
    });
  });

  describe('resumeAnalysisSchema', () => {
    it('validates and cleans a valid resume analysis payload', () => {
      const raw = {
        skills: [' TypeScript ', 'typescript', 'Node.js', 'john@example.com'],
        technologies: ['PostgreSQL', 'Docker', 'docker', '+1-555-0199'],
        projects: ['StackPrep interview platform'],
        experience: ['Senior Backend Engineer at Acme (2020 - 2024)'],
        education: ['B.S. in Computer Science, MIT'],
      };

      const parsed = resumeAnalysisSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.skills).toEqual(['TypeScript', 'Node.js']);
      expect(parsed.data.technologies).toEqual(['PostgreSQL', 'Docker']);
      expect(parsed.data.projects).toEqual(['StackPrep interview platform']);
      expect(parsed.data.experience).toEqual(['Senior Backend Engineer at Acme (2020 - 2024)']);
      expect(parsed.data.education).toEqual(['B.S. in Computer Science, MIT']);
    });

    it('enforces exact caps for all sections', () => {
      const raw = {
        skills: Array.from({ length: 80 }, (_, i) => `Skill ${i}`),
        technologies: Array.from({ length: 90 }, (_, i) => `Tech ${i}`),
        projects: Array.from({ length: 25 }, (_, i) => `Project ${i}`),
        experience: Array.from({ length: 25 }, (_, i) => `Exp ${i}`),
        education: Array.from({ length: 20 }, (_, i) => `Edu ${i}`),
      };

      const parsed = resumeAnalysisSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      expect(parsed.data.skills).toHaveLength(CAPS.skills); // 50
      expect(parsed.data.technologies).toHaveLength(CAPS.technologies); // 60
      expect(parsed.data.projects).toHaveLength(CAPS.projects); // 15
      expect(parsed.data.experience).toHaveLength(CAPS.experience); // 15
      expect(parsed.data.education).toHaveLength(CAPS.education); // 10
    });

    it('fails validation when skills, technologies, experience, and projects are ALL empty', () => {
      const raw = {
        skills: [],
        technologies: [],
        projects: [],
        experience: [],
        education: ['B.S. in Computer Science'],
      };

      const parsed = resumeAnalysisSchema.safeParse(raw);
      expect(parsed.success).toBe(false);
    });

    it('fails validation when skills, technologies, experience, and projects become empty after email/phone stripping', () => {
      const raw = {
        skills: ['user@example.com'],
        technologies: ['+1-555-0199'],
        projects: ['(555) 123-4567'],
        experience: ['555-123-4567'],
        education: ['University'],
      };

      const parsed = resumeAnalysisSchema.safeParse(raw);
      expect(parsed.success).toBe(false);
    });

    it('succeeds validation if at least one of (skills, technologies, experience, projects) has an entry', () => {
      const rawOnlySkills = {
        skills: ['TypeScript'],
        technologies: [],
        projects: [],
        experience: [],
        education: [],
      };
      expect(resumeAnalysisSchema.safeParse(rawOnlySkills).success).toBe(true);

      const rawOnlyTech = {
        skills: [],
        technologies: ['Docker'],
        projects: [],
        experience: [],
        education: [],
      };
      expect(resumeAnalysisSchema.safeParse(rawOnlyTech).success).toBe(true);

      const rawOnlyExp = {
        skills: [],
        technologies: [],
        projects: [],
        experience: ['Engineer at Google'],
        education: [],
      };
      expect(resumeAnalysisSchema.safeParse(rawOnlyExp).success).toBe(true);

      const rawOnlyProjects = {
        skills: [],
        technologies: [],
        projects: ['Portfolio Website'],
        experience: [],
        education: [],
      };
      expect(resumeAnalysisSchema.safeParse(rawOnlyProjects).success).toBe(true);
    });

    it('fails validation when input is not an object or is null/empty', () => {
      expect(resumeAnalysisSchema.safeParse(null).success).toBe(false);
      expect(resumeAnalysisSchema.safeParse('not an object').success).toBe(false);
      expect(resumeAnalysisSchema.safeParse({}).success).toBe(false);
    });
  });
});
