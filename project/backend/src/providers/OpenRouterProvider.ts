// ============================================================
// OpenRouterProvider — Implements AIProvider using the openai package
// pointed at the OpenRouter endpoint (OpenAI-compatible API)
// ============================================================

import OpenAI from 'openai';
import { aiConfig } from '../config/ai.config';
import {
  buildEvaluationPrompt,
  buildFollowUpPrompt,
  buildQuestionPrompt,
  buildReportPrompt,
  buildResumeAnalysisPrompt,
} from '../prompts/builders';
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

export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  readonly model: string;

  private readonly client: OpenAI;
  private readonly modelName: string;

  constructor() {
    const { apiKey, model } = aiConfig.openrouter;
    if (!apiKey) {
      throw new Error('OpenRouterProvider: OPENROUTER_API_KEY is not set');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
    });
    this.modelName = model;
    this.model = model;
  }

  // ── Private helpers ──────────────────────────────────────

  private async generateJSON<T>(prompt: string): Promise<T> {
    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '';
    return JSON.parse(content) as T;
  }

  // ── AIProvider methods ───────────────────────────────────

  async generateQuestion(params: GenerateQuestionParams): Promise<GeneratedQuestion> {
    return this.generateJSON<GeneratedQuestion>(buildQuestionPrompt(params));
  }

  async evaluateAnswer(params: EvaluateAnswerParams): Promise<GeneratedEvaluation> {
    return this.generateJSON<GeneratedEvaluation>(buildEvaluationPrompt(params));
  }

  async generateFollowUp(params: GenerateFollowUpParams): Promise<GeneratedQuestion> {
    return this.generateJSON<GeneratedQuestion>(buildFollowUpPrompt(params));
  }

  async analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisResult> {
    return this.generateJSON<ResumeAnalysisResult>(buildResumeAnalysisPrompt(params));
  }

  async generateReport(params: GenerateReportParams): Promise<GeneratedReport> {
    return this.generateJSON<GeneratedReport>(buildReportPrompt(params));
  }

  /**
   * OpenRouter does not expose an embeddings endpoint.
   * Use AIService.generateEmbedding() which always delegates to Gemini.
   */
  async generateEmbedding(_text: string): Promise<number[]> {
    throw new Error(
      'OpenRouterProvider does not support generateEmbedding. ' +
        'Embeddings are always handled by GeminiProvider via AIService.',
    );
  }
}
