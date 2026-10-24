function getEnvInt(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultVal;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`[followup.config] ${key} must be an integer, got: "${raw}"`);
  return parsed;
}

function getEnvBool(key: string, defaultVal: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return defaultVal;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`[followup.config] ${key} must be true/false, got: "${raw}"`);
}

function validate(cfg: FollowUpConfig): void {
  const errors: string[] = [];
  if (cfg.strongScore < 0 || cfg.strongScore > 10)
    errors.push(`FOLLOWUP_STRONG_SCORE must be 0-10, got ${cfg.strongScore}`);
  if (cfg.incompleteThreshold < 0 || cfg.incompleteThreshold > 10)
    errors.push(`FOLLOWUP_INCOMPLETE_THRESHOLD must be 0-10, got ${cfg.incompleteThreshold}`);
  if (cfg.minRelevance < 0 || cfg.minRelevance > 10)
    errors.push(`FOLLOWUP_MIN_RELEVANCE must be 0-10, got ${cfg.minRelevance}`);
  if (cfg.maxPerInterview < 0)
    errors.push(`FOLLOWUP_MAX_PER_INTERVIEW must be >= 0, got ${cfg.maxPerInterview}`);
  if (cfg.maxDepth < 0)
    errors.push(`FOLLOWUP_MAX_DEPTH must be >= 0, got ${cfg.maxDepth}`);
  if (errors.length > 0)
    throw new Error(`[followup.config] Invalid configuration:\n  ${errors.join('\n  ')}`);
}

export interface FollowUpConfig {
  enabled: boolean;
  strongScore: number;
  incompleteThreshold: number;
  minRelevance: number;
  maxPerInterview: number;
  maxDepth: number;
}

function buildConfig(): FollowUpConfig {
  const cfg: FollowUpConfig = {
    enabled: getEnvBool('FOLLOWUP_ENABLED', true),
    strongScore: getEnvInt('FOLLOWUP_STRONG_SCORE', 8),
    incompleteThreshold: getEnvInt('FOLLOWUP_INCOMPLETE_THRESHOLD', 6),
    minRelevance: getEnvInt('FOLLOWUP_MIN_RELEVANCE', 3),
    maxPerInterview: getEnvInt('FOLLOWUP_MAX_PER_INTERVIEW', 3),
    maxDepth: getEnvInt('FOLLOWUP_MAX_DEPTH', 1),
  };
  validate(cfg);
  return cfg;
}

export const followUpConfig: FollowUpConfig = buildConfig();
