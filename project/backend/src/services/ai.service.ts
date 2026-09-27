// ============================================================
// AIService — singleton that orchestrates all AI providers
// with automatic fallback on failure.
// ============================================================

import { aiConfig } from '../config/ai.config';
import { GeminiProvider } from '../providers/GeminiProvider';
import { GroqProvider } from '../providers/GroqProvider';
import { OpenRouterProvider } from '../providers/OpenRouterProvider';
import {
  AIProvider,
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

// ── Provider factory ─────────────────────────────────────────

function buildProvider(name: string): AIProvider {
  switch (name) {
    case 'gemini':
      return new GeminiProvider();
    case 'groq':
      return new GroqProvider();
    case 'openrouter':
      return new OpenRouterProvider();
    default:
      throw new Error(`Unknown AI provider: "${name}"`);
  }
}

// ── Service class ────────────────────────────────────────────

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
        console.warn(
          `[AIService] Skipping provider "${name}": ${(err as Error).message}`,
        );
      }
    }

    if (providers.length === 0) {
      throw new Error(
        '[AIService] No AI providers could be initialised. ' +
          'Set at least one of GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.',
      );
    }

    this.providers = providers;
    this.geminiProvider = geminiProvider;

    console.log(
      `[AIService] Initialised with providers: [${providers.map((p) => p.name).join(', ')}]`,
    );
  }

  // ── Fallback runner ────────────────────────────────────────

  /**
   * Try each provider in order. On failure, log a warning and try the next.
   * Throws only after every provider has been tried.
   */
  private async withFallback<T>(
    operation: string,
    fn: (provider: AIProvider) => Promise<T>,
  ): Promise<T> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        const result = await fn(provider);
        console.log(`[AIService] "${operation}" handled by provider: ${provider.name}`);
        return result;
      } catch (err) {
        const msg = (err as Error).message;
        console.warn(
          `[AIService] Provider "${provider.name}" failed for "${operation}": ${msg}. Trying next provider...`,
        );
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    throw new Error(
      `[AIService] All providers failed for "${operation}":\n${errors.join('\n')}`,
    );
  }

  // ── Public API ─────────────────────────────────────────────

  async generateQuestion(params: GenerateQuestionParams): Promise<GeneratedQuestion> {
    return this.withFallback('generateQuestion', (p) => p.generateQuestion(params));
  }

  async evaluateAnswer(params: EvaluateAnswerParams): Promise<GeneratedEvaluation> {
    return this.withFallback('evaluateAnswer', (p) => p.evaluateAnswer(params));
  }

  async generateFollowUp(params: GenerateFollowUpParams): Promise<GeneratedQuestion> {
    return this.withFallback('generateFollowUp', (p) => p.generateFollowUp(params));
  }

  async analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisResult> {
    return this.withFallback('analyzeResume', (p) => p.analyzeResume(params));
  }

  async generateReport(params: GenerateReportParams): Promise<GeneratedReport> {
    return this.withFallback('generateReport', (p) => p.generateReport(params));
  }

  /**
   * Always delegates to the Gemini provider directly, since Groq and
   * OpenRouter do not support embedding generation.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.geminiProvider) {
      throw new Error(
        '[AIService] generateEmbedding requires GEMINI_API_KEY to be set. ' +
          'Groq and OpenRouter do not support embeddings.',
      );
    }
    console.log('[AIService] "generateEmbedding" handled by provider: gemini');
    return this.geminiProvider.generateEmbedding(text);
  }
}

// Export a single shared instance
export const AIService = new AIServiceManager();
export const AIServiceInstance = AIService;
