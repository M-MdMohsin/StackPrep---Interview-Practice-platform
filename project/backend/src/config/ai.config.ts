// ============================================================
// AI Configuration — reads from environment variables
// ============================================================

export const aiConfig = {
  /**
   * Ordered list of providers to try. Set AI_PROVIDER_ORDER in .env
   * as a comma-separated string, e.g. "groq,gemini,openrouter".
   * Defaults to "gemini,groq,openrouter".
   */
  providerOrder: (process.env.AI_PROVIDER_ORDER ?? 'gemini,groq,openrouter')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as ('gemini' | 'groq' | 'openrouter')[],

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-2',
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
  },

  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-70b-instruct',
  },
};
