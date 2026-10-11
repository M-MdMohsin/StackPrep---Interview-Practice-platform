import { describe, it, expect } from 'vitest';
import {
  getPendingQuestion,
  getLastCompletedQuestion,
  countTopLevel,
  QuestionState,
} from '../../src/services/interview-state.service';

describe('interview-state.service', () => {
  it('returns null for an empty list', () => {
    expect(getPendingQuestion([])).toBeNull();
    expect(getLastCompletedQuestion([])).toBeNull();
    expect(countTopLevel([])).toBe(0);
  });

  it('returns null when all questions are complete', () => {
    const questions: QuestionState[] = [
      {
        id: 'q1',
        orderIndex: 1,
        parentQuestionId: null,
        answer: { id: 'a1', evaluation: { id: 'e1' } },
      },
      {
        id: 'q2',
        orderIndex: 2,
        parentQuestionId: null,
        answer: { id: 'a2', evaluation: { id: 'e2' } },
      },
    ];

    expect(getPendingQuestion(questions)).toBeNull();
    expect(getLastCompletedQuestion(questions)?.id).toBe('q2');
    expect(countTopLevel(questions)).toBe(2);
  });

  it('identifies the last unanswered question as pending', () => {
    const questions: QuestionState[] = [
      {
        id: 'q1',
        orderIndex: 1,
        parentQuestionId: null,
        answer: { id: 'a1', evaluation: { id: 'e1' } },
      },
      {
        id: 'q2',
        orderIndex: 2,
        parentQuestionId: null,
        answer: null,
      },
    ];

    const pending = getPendingQuestion(questions);
    expect(pending?.id).toBe('q2');
  });

  it('identifies the last answered-without-evaluation question as pending', () => {
    const questions: QuestionState[] = [
      {
        id: 'q1',
        orderIndex: 1,
        parentQuestionId: null,
        answer: { id: 'a1', evaluation: { id: 'e1' } },
      },
      {
        id: 'q2',
        orderIndex: 2,
        parentQuestionId: null,
        answer: { id: 'a2', evaluation: null },
      },
    ];

    const pending = getPendingQuestion(questions);
    expect(pending?.id).toBe('q2');
  });

  it('identifies an unanswered follow-up (parentQuestionId set) as pending', () => {
    const questions: QuestionState[] = [
      {
        id: 'q1',
        orderIndex: 1,
        parentQuestionId: null,
        answer: { id: 'a1', evaluation: { id: 'e1' } },
      },
      {
        id: 'q1-followup',
        orderIndex: 2,
        parentQuestionId: 'q1',
        answer: null,
      },
    ];

    const pending = getPendingQuestion(questions);
    expect(pending?.id).toBe('q1-followup');
    expect(countTopLevel(questions)).toBe(1);
  });

  it('produces the same pending question regardless of input sort order', () => {
    const q1: QuestionState = {
      id: 'q1',
      orderIndex: 1,
      parentQuestionId: null,
      answer: { id: 'a1', evaluation: { id: 'e1' } },
    };
    const q2: QuestionState = {
      id: 'q2',
      orderIndex: 2,
      parentQuestionId: null,
      answer: { id: 'a2', evaluation: { id: 'e2' } },
    };
    const q3: QuestionState = {
      id: 'q3',
      orderIndex: 3,
      parentQuestionId: null,
      answer: null,
    };

    const ordered = [q1, q2, q3];
    const shuffled1 = [q3, q1, q2];
    const shuffled2 = [q2, q3, q1];

    expect(getPendingQuestion(ordered)?.id).toBe('q3');
    expect(getPendingQuestion(shuffled1)?.id).toBe('q3');
    expect(getPendingQuestion(shuffled2)?.id).toBe('q3');
  });

  it('returns previous question from getLastCompletedQuestion with a trailing pending question', () => {
    const questions: QuestionState[] = [
      {
        id: 'q1',
        orderIndex: 1,
        parentQuestionId: null,
        answer: { id: 'a1', evaluation: { id: 'e1' } },
      },
      {
        id: 'q2',
        orderIndex: 2,
        parentQuestionId: null,
        answer: { id: 'a2', evaluation: { id: 'e2' } },
      },
      {
        id: 'q3',
        orderIndex: 3,
        parentQuestionId: null,
        answer: null,
      },
    ];

    expect(getPendingQuestion(questions)?.id).toBe('q3');
    expect(getLastCompletedQuestion(questions)?.id).toBe('q2');
  });
});
