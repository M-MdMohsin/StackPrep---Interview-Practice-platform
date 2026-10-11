import { prisma } from '../config/prisma';
import { buildQuestionPrompt, buildEvaluationPrompt } from '../prompts/builders';

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
