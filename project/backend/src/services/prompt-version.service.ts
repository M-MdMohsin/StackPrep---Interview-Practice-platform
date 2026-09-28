import { prisma } from '../config/prisma';
import { buildQuestionPrompt } from '../prompts/builders';

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

    // Build template — for question-generation, use the prompt builder with placeholder params
    const template = task === 'question-generation'
      ? buildQuestionPrompt({ role: '__role__', experienceLevel: '__level__', interviewType: '__type__', difficulty: '__difficulty__' })
      : `${task} template`;

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
