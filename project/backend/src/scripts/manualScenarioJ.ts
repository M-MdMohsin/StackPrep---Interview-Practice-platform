import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE_URL = process.env.API_URL ?? 'http://localhost:5001';
const prisma = new PrismaClient();

async function apiCall(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  const ts = Date.now();
  console.log('\n--- Manual Scenario J Test ---');

  // Sign up
  const signupRes = await apiCall('POST', '/api/auth/signup', {
    email: `manual_j_${ts}@test.com`,
    password: 'TestPass123!',
    name: 'Manual J User',
  });
  const token = signupRes.data.accessToken;
  const user = await prisma.user.findUnique({ where: { email: `manual_j_${ts}@test.com` } });

  // Create interview
  const intRes = await apiCall('POST', '/api/interviews', {
    role: 'Backend Developer',
    experienceLevel: 'MID',
    interviewType: 'TECHNICAL',
    difficulty: 'MEDIUM',
    questionLimit: 5,
  }, token);
  const interviewId = intRes.data.interview.id;

  // Insert a completed question directly into DB with weak evaluation
  const q1 = await prisma.question.create({
    data: {
      interviewId,
      questionText: 'Explain database normalization and denormalization trade-offs.',
      orderIndex: 1,
      source: 'AI_GENERATED',
      status: 'ANSWERED',
    },
  });

  const ans1 = await prisma.answer.create({
    data: {
      questionId: q1.id,
      answerText: 'Normalization splits tables into smaller tables.',
    },
  });

  await prisma.evaluation.create({
    data: {
      answerId: ans1.id,
      score: 3,
      completenessScore: 3,
      relevanceScore: 7,
      accuracyScore: 5,
      clarityScore: 6,
      communicationScore: 6,
      strengths: ['Basic definition given'],
      weaknesses: ['Missed trade-offs', 'Missed write vs read performance'],
      missingConcepts: ['3NF principles', 'Write overhead vs read latency'],
      feedback: 'Needs more depth.',
      idealAnswer: 'Ideal response...',
    },
  });

  const countBefore = await prisma.question.count({ where: { interviewId } });
  const usageBefore = await prisma.usageLimit.findUnique({ where: { userId: user!.id } });
  const initialUsed = usageBefore?.dailyUsed ?? 0;

  // Call /generate: expect 502 AI_UNAVAILABLE because all providers fail
  const genRes = await apiCall('POST', `/api/interviews/${interviewId}/questions/generate`, undefined, token);
  console.log('Generate response status:', genRes.status, genRes.data);

  const countAfter = await prisma.question.count({ where: { interviewId } });
  const usageAfter = await prisma.usageLimit.findUnique({ where: { userId: user!.id } });

  const aiUsageFailure = await prisma.aIUsage.findFirst({
    where: {
      userId: user!.id,
      requestType: 'FOLLOW_UP',
      status: 'FAILURE',
      failureCategory: 'ALL_PROVIDERS_FAILED',
    },
  });

  // Check lock is not stuck by attempting an immediate call
  const immediateNextCall = await apiCall('POST', `/api/interviews/${interviewId}/questions/generate`, undefined, token);
  const lockNotStuck = immediateNextCall.status === 502; // Still 502, not 409 GENERATION_IN_PROGRESS

  console.log('Summary:');
  console.log('- Status is 502 AI_UNAVAILABLE:', genRes.status === 502 && genRes.data?.code === 'AI_UNAVAILABLE');
  console.log('- No new question created:', countAfter === countBefore);
  console.log('- dailyUsed unchanged:', usageAfter?.dailyUsed === initialUsed);
  console.log('- FOLLOW_UP FAILURE AIUsage row exists:', aiUsageFailure !== null);
  console.log('- Lock not stuck (next call returns 502 not 409):', lockNotStuck);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
