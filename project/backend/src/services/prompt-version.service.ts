import { prisma } from '../config/prisma';
import { buildQuestionPrompt, buildEvaluationPrompt, buildFollowUpPrompt } from '../prompts/builders';

const cache = new Map<string, string>(); // key -> promptVersionId

export class PromptVersionService {
  static async getOrCreatePromptVersion(
    task: string,
    versionLabel: string,
    provider: string,
    model: string,
  ): Promise<string> {
    const cacheKey = `${task}:${versionLabel}:${provider}:${model}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    let template = `${task} template`;
    if (task === 'question-generation') {
      template = buildQuestionPrompt({
        role: '__role__',
        experienceLevel: '__level__',
        interviewType: '__type__',
        difficulty: '__difficulty__',
      });
    } else if (task === 'evaluation') {
      template = buildEvaluationPrompt({
        questionText: '__question__',
        answerText: '__answer__',
        role: '__role__',
        difficulty: '__difficulty__',
      });
    } else if (task === 'follow-up') {
      template = buildFollowUpPrompt({
        originalQuestion: '__question__',
        answerText: '__answer__',
        evaluation: {
          score: 0,
          accuracyScore: 0,
          clarityScore: 0,
          completenessScore: 0,
          relevanceScore: 0,
          communicationScore: 0,
          strengths: [],
          weaknesses: [],
          missingConcepts: [],
          feedback: '__feedback__',
          idealAnswer: '',
        },
      });
    }

    const record = await prisma.promptVersion.upsert({
      where: { task_versionLabel_provider_model: { task, versionLabel, provider, model } },
      create: { task, versionLabel, provider, model, template, isActive: true },
      update: {},
      select: { id: true },
    });

    cache.set(cacheKey, record.id);
    return record.id;
  }
}
