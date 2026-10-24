import { describe, it, expect } from 'vitest';
import {
  decideFollowUp,
  getQuestionDepth,
  DecideFollowUpInput,
  QuestionNode,
} from '../../src/services/followup-policy.service';
import { FollowUpConfig } from '../../src/config/followup.config';

const defaultConfig: FollowUpConfig = {
  enabled: true,
  strongScore: 8,
  incompleteThreshold: 6,
  minRelevance: 3,
  maxPerInterview: 3,
  maxDepth: 1,
};

describe('followup-policy.service', () => {
  describe('decideFollowUp - Branch Coverage & Ordering', () => {
    it('returns DISABLED when config.enabled is false', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 4, completenessScore: 3, relevanceScore: 8, missingConcepts: ['A'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, { ...defaultConfig, enabled: false });
      expect(result).toEqual({ followUp: false, reason: 'DISABLED' });
    });

    it('returns DEPTH_LIMIT when depth >= maxDepth', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 4, completenessScore: 3, relevanceScore: 8, missingConcepts: ['A'] },
        depth: 1,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: false, reason: 'DEPTH_LIMIT' });
    });

    it('returns BUDGET_EXHAUSTED when followUpsUsed >= maxPerInterview', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 4, completenessScore: 3, relevanceScore: 8, missingConcepts: ['A'] },
        depth: 0,
        followUpsUsed: 3,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: false, reason: 'BUDGET_EXHAUSTED' });
    });

    it('returns OFF_TOPIC when relevanceScore < minRelevance', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 4, completenessScore: 3, relevanceScore: 2, missingConcepts: ['A'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: false, reason: 'OFF_TOPIC' });
    });

    it('returns STRONG_ANSWER when score >= strongScore', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 8, completenessScore: 9, relevanceScore: 9, missingConcepts: ['Minor gap'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: false, reason: 'STRONG_ANSWER' });
    });

    it('returns MISSING_CONCEPTS when score < strongScore and missingConcepts has items', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 5, completenessScore: 8, relevanceScore: 7, missingConcepts: ['Concurrency'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: true, reason: 'MISSING_CONCEPTS' });
    });

    it('returns INCOMPLETE when missingConcepts is empty and completenessScore <= incompleteThreshold', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 6, completenessScore: 6, relevanceScore: 7, missingConcepts: [] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: true, reason: 'INCOMPLETE' });
    });

    it('returns NOTHING_TO_PROBE when completenessScore > incompleteThreshold and no missing concepts', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 7, completenessScore: 7, relevanceScore: 7, missingConcepts: [] },
        depth: 0,
        followUpsUsed: 0,
      };
      const result = decideFollowUp(input, defaultConfig);
      expect(result).toEqual({ followUp: false, reason: 'NOTHING_TO_PROBE' });
    });
  });

  describe('decideFollowUp - Strict Precedence / Ordering Checks', () => {
    it('DISABLED beats DEPTH_LIMIT', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 3, completenessScore: 3, relevanceScore: 8, missingConcepts: ['A'] },
        depth: 2,
        followUpsUsed: 5,
      };
      const res = decideFollowUp(input, { ...defaultConfig, enabled: false });
      expect(res.reason).toBe('DISABLED');
    });

    it('DEPTH_LIMIT beats BUDGET_EXHAUSTED and MISSING_CONCEPTS', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 3, completenessScore: 3, relevanceScore: 8, missingConcepts: ['A'] },
        depth: 1,
        followUpsUsed: 3,
      };
      const res = decideFollowUp(input, defaultConfig);
      expect(res.reason).toBe('DEPTH_LIMIT');
    });

    it('BUDGET_EXHAUSTED beats OFF_TOPIC', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 2, completenessScore: 2, relevanceScore: 1, missingConcepts: ['A'] },
        depth: 0,
        followUpsUsed: 3,
      };
      const res = decideFollowUp(input, defaultConfig);
      expect(res.reason).toBe('BUDGET_EXHAUSTED');
    });

    it('OFF_TOPIC beats STRONG_ANSWER and INCOMPLETE', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 9, completenessScore: 4, relevanceScore: 2, missingConcepts: ['A'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const res = decideFollowUp(input, defaultConfig);
      expect(res.reason).toBe('OFF_TOPIC');
    });

    it('STRONG_ANSWER beats MISSING_CONCEPTS', () => {
      const input: DecideFollowUpInput = {
        evaluation: { score: 9, completenessScore: 9, relevanceScore: 9, missingConcepts: ['Edge cases'] },
        depth: 0,
        followUpsUsed: 0,
      };
      const res = decideFollowUp(input, defaultConfig);
      expect(res.reason).toBe('STRONG_ANSWER');
    });
  });

  describe('decideFollowUp - Boundary Values', () => {
    it('depth boundaries (maxDepth = 1)', () => {
      const evalData = { score: 5, completenessScore: 4, relevanceScore: 8, missingConcepts: ['A'] };
      expect(decideFollowUp({ evaluation: evalData, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('MISSING_CONCEPTS');
      expect(decideFollowUp({ evaluation: evalData, depth: 1, followUpsUsed: 0 }, defaultConfig).reason).toBe('DEPTH_LIMIT');
    });

    it('followUpsUsed boundaries (maxPerInterview = 3)', () => {
      const evalData = { score: 5, completenessScore: 4, relevanceScore: 8, missingConcepts: ['A'] };
      expect(decideFollowUp({ evaluation: evalData, depth: 0, followUpsUsed: 2 }, defaultConfig).reason).toBe('MISSING_CONCEPTS');
      expect(decideFollowUp({ evaluation: evalData, depth: 0, followUpsUsed: 3 }, defaultConfig).reason).toBe('BUDGET_EXHAUSTED');
    });

    it('relevanceScore boundaries (minRelevance = 3)', () => {
      const base = { score: 5, completenessScore: 4, missingConcepts: ['A'] };
      expect(decideFollowUp({ evaluation: { ...base, relevanceScore: 2 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('OFF_TOPIC');
      expect(decideFollowUp({ evaluation: { ...base, relevanceScore: 3 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('MISSING_CONCEPTS');
    });

    it('score boundaries (strongScore = 8)', () => {
      const base = { completenessScore: 8, relevanceScore: 8, missingConcepts: ['A'] };
      expect(decideFollowUp({ evaluation: { ...base, score: 7 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('MISSING_CONCEPTS');
      expect(decideFollowUp({ evaluation: { ...base, score: 8 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('STRONG_ANSWER');
    });

    it('completenessScore boundaries (incompleteThreshold = 6)', () => {
      const base = { score: 6, relevanceScore: 8, missingConcepts: [] };
      expect(decideFollowUp({ evaluation: { ...base, completenessScore: 6 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('INCOMPLETE');
      expect(decideFollowUp({ evaluation: { ...base, completenessScore: 7 }, depth: 0, followUpsUsed: 0 }, defaultConfig).reason).toBe('NOTHING_TO_PROBE');
    });
  });

  describe('getQuestionDepth', () => {
    it('returns 0 for a top-level question', () => {
      const q: QuestionNode = { id: 'q1', parentQuestionId: null };
      const map = new Map<string, QuestionNode>([['q1', q]]);
      expect(getQuestionDepth(q, map)).toBe(0);
    });

    it('returns 1 for a direct child of a top-level question', () => {
      const q1: QuestionNode = { id: 'q1', parentQuestionId: null };
      const q2: QuestionNode = { id: 'q2', parentQuestionId: 'q1' };
      const map = new Map<string, QuestionNode>([
        ['q1', q1],
        ['q2', q2],
      ]);
      expect(getQuestionDepth(q2, map)).toBe(1);
    });

    it('returns 2 for depth 2 hierarchy', () => {
      const q1: QuestionNode = { id: 'q1', parentQuestionId: null };
      const q2: QuestionNode = { id: 'q2', parentQuestionId: 'q1' };
      const q3: QuestionNode = { id: 'q3', parentQuestionId: 'q2' };
      const map = new Map<string, QuestionNode>([
        ['q1', q1],
        ['q2', q2],
        ['q3', q3],
      ]);
      expect(getQuestionDepth(q3, map)).toBe(2);
    });

    it('handles missing parent safely without crashing', () => {
      const qOrphan: QuestionNode = { id: 'orphan', parentQuestionId: 'unknown-parent' };
      const map = new Map<string, QuestionNode>([['orphan', qOrphan]]);
      expect(getQuestionDepth(qOrphan, map)).toBe(1);
    });

    it('guards against malformed parent loops (A -> B -> A)', () => {
      const qA: QuestionNode = { id: 'A', parentQuestionId: 'B' };
      const qB: QuestionNode = { id: 'B', parentQuestionId: 'A' };
      const map = new Map<string, QuestionNode>([
        ['A', qA],
        ['B', qB],
      ]);
      // Should break loop cleanly and not hang
      const depth = getQuestionDepth(qA, map);
      expect(depth).toBeGreaterThanOrEqual(1);
      expect(depth).toBeLessThanOrEqual(100);
    });
  });
});
