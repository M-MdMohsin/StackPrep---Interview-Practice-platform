// ============================================================
// GeminiProvider — Implements AIProvider using @google/generative-ai
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';
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

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;
  private readonly embeddingModelName: string;

  constructor() {
    const { apiKey, model, embeddingModel } = aiConfig.gemini;
    if (!apiKey) {
      throw new Error('GeminiProvider: GEMINI_API_KEY is not set');
    }
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
    this.embeddingModelName = embeddingModel;
  }

  // ── Private helpers ──────────────────────────────────────

  private getModel() {
    return this.client.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
  }

  /**
   * Strip markdown fences defensively before JSON.parse,
   * even though we request JSON mode — some model versions still
   * occasionally wrap the response.
   */
  private stripFences(raw: string): string {
    return raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }

  private async generateJSON<T>(prompt: string): Promise<T> {
    const model = this.getModel();
    const result = await model.generateContent(prompt);
    const raw = result.response.text();
    const cleaned = this.stripFences(raw);
    return JSON.parse(cleaned) as T;
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

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.client.getGenerativeModel({
      model: this.embeddingModelName,
    });
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  }
}
