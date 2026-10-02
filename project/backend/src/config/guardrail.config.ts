export const guardrailConfig = {
  policy: (process.env.ANSWER_GUARDRAIL_POLICY ?? 'flag') as 'flag' | 'reject',
};
