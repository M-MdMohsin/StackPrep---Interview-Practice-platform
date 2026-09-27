// ============================================================
// AI Types — shared interfaces for the AI provider abstraction
// ============================================================

// ── Question Generation ──────────────────────────────────────

export interface GenerateQuestionParams {
  role: string;
  experienceLevel: string;
  interviewType: string;
  difficulty: string;
  topic?: string;
  retrievedContext?: string;
  previousQuestions?: string[];
}

export interface GeneratedQuestion {
  questionText: string;
  topic: string;
  category: string;
  difficulty: string;
  questionType: string;
}

// ── Answer Evaluation ────────────────────────────────────────

export interface EvaluateAnswerParams {
  questionText: string;
  answerText: string;
  role: string;
  difficulty: string;
}

export interface GeneratedEvaluation {
  score: number;
  accuracyScore: number;
  clarityScore: number;
  completenessScore: number;
  relevanceScore: number;
  communicationScore: number;
  strengths: string[];
  weaknesses: string[];
  missingConcepts: string[];
  feedback: string;
  idealAnswer: string;
}

// ── Follow-Up Generation ─────────────────────────────────────

export interface GenerateFollowUpParams {
  originalQuestion: string;
  answerText: string;
  evaluation: GeneratedEvaluation;
}

// ── Resume Analysis ──────────────────────────────────────────

export interface AnalyzeResumeParams {
  resumeText: string;
}

export interface ResumeAnalysisResult {
  skills: string[];
  projects: string[];
  experience: string[];
  education: string[];
  technologies: string[];
}

// ── Report Generation ────────────────────────────────────────

export interface GenerateReportParams {
  interviewSummary: string;
}

export interface GeneratedReport {
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

// ── Provider Interface ───────────────────────────────────────

export interface AIProvider {
  /** Human-readable name for logging */
  name: string;

  generateQuestion(params: GenerateQuestionParams): Promise<GeneratedQuestion>;
  evaluateAnswer(params: EvaluateAnswerParams): Promise<GeneratedEvaluation>;
  generateFollowUp(params: GenerateFollowUpParams): Promise<GeneratedQuestion>;
  analyzeResume(params: AnalyzeResumeParams): Promise<ResumeAnalysisResult>;
  generateReport(params: GenerateReportParams): Promise<GeneratedReport>;

  /**
   * Generate a vector embedding for the given text.
   * Only Gemini supports this; Groq/OpenRouter providers throw a clear error.
   */
  generateEmbedding(text: string): Promise<number[]>;
}
