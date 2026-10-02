import { logger } from '../config/logger';

interface InjectionPattern {
  name: string;
  regex: RegExp;
  isHighConfidence?: boolean;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // High confidence: "ignore/disregard" co-occurring with rubric/instructions/score/grading
  {
    name: 'ignore_rubric_or_score',
    regex: /\b(?:ignore|disregard|forget|bypass)\b[^\.\n\r;]{0,100}\b(?:rubric|instructions?|guidelines?|rules?|criteria|score|grading|evaluation)\b/i,
    isHighConfidence: true,
  },
  // High confidence: explicit score demand
  {
    name: 'demand_score',
    regex: /\b(?:give|award|assign)\s+(?:me|this\s+candidate|the\s+candidate|us)\s+(?:a\s+)?(?:10(?:\/10)?|perfect|full|maximum|highest)\s*(?:score|marks?|grade|points?|rating|\/10)?\b/i,
    isHighConfidence: true,
  },
  // High confidence: override grading
  {
    name: 'override_grading',
    regex: /\boverride\s+(?:the\s+)?(?:grading|score|evaluation|rubric|assessment)\b/i,
    isHighConfidence: true,
  },
  // Generic instruction override
  {
    name: 'ignore_instructions_generic',
    regex: /\b(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)?\s*(?:instructions?|prompts?|rules?|directives?)\b/i,
  },
  // Persona shift
  {
    name: 'you_are_now',
    regex: /\byou\s+are\s+now\b/i,
  },
  // New instructions directive
  {
    name: 'new_instructions',
    regex: /\bnew\s+instructions?\b/i,
  },
  // System prompt delimiter
  {
    name: 'system_marker',
    regex: /(?:^|[\r\n])\s*system\s*:/i,
  },
  // Instruction tag delimiter
  {
    name: 'instruction_tag',
    regex: /###\s*instruction/i,
  },
  // Act as directive
  {
    name: 'act_as',
    regex: /\bact\s+as\s+(?:an?|the)?\b/i,
  },
];

export interface InjectionDetectionResult {
  flagged: boolean;
  matchCount: number;
  severity: 'low' | 'high';
}

export function detectInjection(text: string): InjectionDetectionResult {
  let matchCount = 0;
  let hasHighConfidenceMatch = false;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.regex.test(text)) {
      matchCount++;
      if (pattern.isHighConfidence) {
        hasHighConfidenceMatch = true;
      }
    }
  }

  const flagged = matchCount > 0;
  const severity: 'low' | 'high' = matchCount >= 2 || hasHighConfidenceMatch ? 'high' : 'low';

  if (flagged) {
    logger.warn({
      event: 'guardrail_flagged',
      source: 'answer',
      severity,
      matchCount,
    });
  }

  return {
    flagged,
    matchCount,
    severity,
  };
}
