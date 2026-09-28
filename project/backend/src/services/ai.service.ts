import { aiConfig } from '../config/ai.config';
import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { OpenRouterProvider } from '../providers/OpenRouterProvider';
import {
  AIProvider,
  AIResult,
  AIMeta,
  AIAttempt,
  AnalyzeResumeParams,
  EvaluateAnswerParams,
  GenerateFollowUpParams,
  GenerateQuestionParams,
  GenerateReportParams,
  GeneratedEvaluation,
  GeneratedQuestion,
  GeneratedReport,
  ResumeAnalysisResult,
} from '../types/ai.types';
import { AIServiceError } from '../errors/AIServiceError';

const REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS ?? '20000', 10);

function buildProvider(name: string): AIProvider {
  switch (name) {
    case 'gemini': return new GeminiProvider();
    case 'groq': return new GroqProvider();
    case 'openrouter': return new OpenRouterProvider();
    default: throw new Error(`Unknown AI provider: "${name}"`);
  }
}

class AIServiceManager {
  private readonly providers: AIProvider[];
  private readonly geminiProvider: GeminiProvider | null;

  constructor() {
    const providers: AIProvider[] = [];
    let geminiProvider: GeminiProvider | null = null;

    for (const name of aiConfig.providerOrder) {
      try {
        const provider = buildProvider(name);
        providers.push(provider);
        if (name === 'gemini' && provider instanceof GeminiProvider) {
          geminiProvider = provider;
        }
      } catch (err) {
        console.warn(`[AIService] Skipping provider "${name}": ${(err as Error).message}`);
      }
    }

    if (providers.length === 0) {
      throw new Error('[AIService] No AI providers could be initialised.');
    }

    this.providers = providers;
    this.geminiProvider = geminiProvider;
    console.log(`[AIService] Initialised with providers: [${providers.map((p) => p.name).join(', ')}]`);
  }

  private async withFallback<T>(
    operation: string,
    fn: (provider: AIProvider) => Promise<T>,
  ): Promise<AIResult<T>> {
    const startTime = Date.now();
    const attempts: AIAttempt[] = [];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      let timedOut = false;
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            reject(new Error(`Provider "${provider.name}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
          }, REQUEST_TIMEOUT_MS)
        );
        const data = await Promise.race([fn(provider), timeoutPromise]);
        const latencyMs = Date.now() - startTime;
        console.log(`[AIService] "${operation}" handled by provider: ${provider.name}`);
        const meta: AIMeta = {
          provider: provider.name,
          model: provider.model,
          latencyMs,
          fallbackCount: i,
        };
        return { data, meta };
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(`[AIService] Provider "${provider.name}" failed for "${operation}": ${msg}. Trying next provider...`);
        attempts.push({ provider: provider.name, model: provider.model, message: msg, timedOut });
      }
    }

    const latencyMs = Date.now() - startTime;
    throw new AIServiceError(attempts, latencyMs);
  }

  async generateQuestion(params: GenerateQuestionParams): Promise<AIResult<GeneratedQuestion>> {
    return this.withFallback('generateQuestion', (p) => p.generateQuestion(params));
  }

  async evaluateAnswer(params: EvaluateAnswerParams): Promise<AIResult<GeneratedEvaluation>> {
    return this.withFallback('evaluateAnswer', (p) => p.evaluateAnswer(params));
  }

  async generateFollowUp(params: GenerateFollowUpParams): Promise<AIResult<GeneratedQuestion>> {
    return this.withFallback('generateFollowUp', (p) => p.generateFollowUp(params));
  }

  async analyzeResume(params: AnalyzeResumeParams): Promise<AIResult<ResumeAnalysisResult>> {
    return this.withFallback('analyzeResume', (p) => p.analyzeResume(params));
  }

  async generateReport(params: GenerateReportParams): Promise<AIResult<GeneratedReport>> {
    return this.withFallback('generateReport', (p) => p.generateReport(params));
  }

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.geminiProvider) {
      throw new Error('[AIService] generateEmbedding requires GEMINI_API_KEY to be set.');
    }
    console.log('[AIService] "generateEmbedding" handled by provider: gemini');
    return this.geminiProvider.generateEmbedding(text);
  }
}

export const AIService = new AIServiceManager();
export const AIServiceInstance = AIService;
