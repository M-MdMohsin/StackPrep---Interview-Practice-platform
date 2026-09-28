import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const BASE_URL = process.env.API_URL ?? 'http://localhost:5000';
const prisma = new PrismaClient();

async function apiCall(method: string, path: string, body?: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { status: res.status, data, headers: res.headers };
}

async function signup(email: string, password: string = 'TestPass123!') {
  const res = await apiCall('POST', '/api/auth/signup', { email, password, name: 'Test User' });
  if (!res.data.accessToken) throw new Error(`Signup failed: ${JSON.stringify(res.data)}`);
  return res.data.accessToken as string;
}

async function createInterview(token: string, questionLimit = 3) {
  const res = await apiCall('POST', '/api/interviews', {
    role: 'Backend Developer',
    experienceLevel: 'MID',
    interviewType: 'TECHNICAL',
    difficulty: 'MEDIUM',
    questionLimit,
  }, token);
  if (!res.data.interview?.id) throw new Error(`Create interview failed: ${JSON.stringify(res.data)}`);
  return res.data.interview.id as string;
}

async function generate(interviewId: string, token: string) {
  return apiCall('POST', `/api/interviews/${interviewId}/questions/generate`, undefined, token);
}

function pass(name: string, evidence: string) {
  console.log(`✅ PASS [${name}]: ${evidence}`);
}

function fail(name: string, evidence: string) {
  console.log(`❌ FAIL [${name}]: ${evidence}`);
  process.exitCode = 1;
}

async function main() {
  const ts = Date.now();
  const email1 = `user1_${ts}@test.com`;
  const email2 = `user2_${ts}@test.com`;

  console.log('\n=== StackPrep Step 7 Verification ===\n');

  const token1 = await signup(email1);
  const token2 = await signup(email2);

  // Get user IDs from DB
  const user1 = await prisma.user.findUnique({ where: { email: email1 } });
  const user2 = await prisma.user.findUnique({ where: { email: email2 } });
  if (!user1 || !user2) throw new Error('Users not found in DB');

  // === Scenario A: Happy path ===
  console.log('\n--- Scenario A: Happy Path ---');
  const interviewId_A = await createInterview(token1, 3);
  const genA = await generate(interviewId_A, token1);
  
  const questionCount_A = await prisma.question.count({ where: { interviewId: interviewId_A } });
  // The property is 'aIUsage' not 'aiUsage' based on prisma camelCasing
  const aiUsageCount_A = await (prisma as any).aIUsage.count({ where: { userId: user1.id, status: 'SUCCESS' } });
  const usageLimit_A = await prisma.usageLimit.findUnique({ where: { userId: user1.id } });
  
  if (genA.status === 201 && genA.data.reused === false && questionCount_A === 1 && aiUsageCount_A >= 1 && (usageLimit_A?.dailyUsed ?? 0) >= 1) {
    pass('A', `status=201, reused=false, questionCount=${questionCount_A}, aiUsageSuccess>0, dailyUsed=${usageLimit_A?.dailyUsed}`);
  } else {
    fail('A', `status=${genA.status}, reused=${genA.data?.reused}, questionCount=${questionCount_A}, aiUsageSuccess=${aiUsageCount_A}, dailyUsed=${usageLimit_A?.dailyUsed}, data=${JSON.stringify(genA.data)}`);
  }

  // === Scenario B: Idempotency ===
  console.log('\n--- Scenario B: Idempotency ---');
  const genB = await generate(interviewId_A, token1);
  const questionCount_B = await prisma.question.count({ where: { interviewId: interviewId_A } });
  const aiUsageCount_B = await (prisma as any).aIUsage.count({ where: { userId: user1.id, status: 'SUCCESS' } });
  const usageLimit_B = await prisma.usageLimit.findUnique({ where: { userId: user1.id } });
  
  if (genB.status === 200 && genB.data.reused === true && questionCount_B === 1 && aiUsageCount_B === aiUsageCount_A && usageLimit_B?.dailyUsed === usageLimit_A?.dailyUsed) {
    pass('B', `status=200, reused=true, questionCount=1 (unchanged), aiUsage=${aiUsageCount_B} (unchanged), dailyUsed=${usageLimit_B?.dailyUsed} (unchanged)`);
  } else {
    fail('B', `status=${genB.status}, reused=${genB.data?.reused}, questionCount=${questionCount_B}, aiUsageCount=${aiUsageCount_B} (was ${aiUsageCount_A}), dailyUsed=${usageLimit_B?.dailyUsed}`);
  }

  // === Scenario C: Concurrency ===
  console.log('\n--- Scenario C: Concurrency ---');
  const interviewId_C = await createInterview(token1, 3);
  const responses_C = await Promise.all([
    generate(interviewId_C, token1),
    generate(interviewId_C, token1),
    generate(interviewId_C, token1),
    generate(interviewId_C, token1),
    generate(interviewId_C, token1),
  ]);
  const questionCount_C = await prisma.question.count({ where: { interviewId: interviewId_C } });
  const statuses_C = responses_C.map(r => r.status);
  const created_C = responses_C.filter(r => r.status === 201).length;
  const no5xx_C = responses_C.every(r => r.status < 500);
  
  if (questionCount_C === 1 && created_C <= 1 && no5xx_C) {
    pass('C', `questionCount=1, created=${created_C}, statuses=${statuses_C.join(',')}`);
  } else {
    fail('C', `questionCount=${questionCount_C}, created=${created_C}, statuses=${statuses_C.join(',')}`);
  }

  // === Scenario D: Authorization ===
  console.log('\n--- Scenario D: Authorization ---');
  const interviewId_D = await createInterview(token1, 3);
  
  // user2 on user1's interview -> 404
  const genD_wrongUser = await generate(interviewId_D, token2);
  // no token -> 401
  const genD_noToken = await generate(interviewId_D, '');
  // malformed id -> 400
  const genD_badId = await apiCall('POST', '/api/interviews/not-a-uuid/questions/generate', undefined, token1);
  
  if (genD_wrongUser.status === 404 && genD_noToken.status === 401 && genD_badId.status === 400 && genD_badId.data?.code === 'INVALID_INTERVIEW_ID') {
    pass('D', `wrongUser=404, noToken=401, badId=400 INVALID_INTERVIEW_ID`);
  } else {
    fail('D', `wrongUser=${genD_wrongUser.status}, noToken=${genD_noToken.status}, badId=${genD_badId.status} code=${genD_badId.data?.code}`);
  }

  // === Scenario E: Usage Cap ===
  console.log('\n--- Scenario E: Usage Cap ---');
  const interviewId_E = await createInterview(token1, 3);
  
  // Set dailyUsed = dailyLimit to exhaust cap
  const usageLimitE = await prisma.usageLimit.findUnique({ where: { userId: user1.id } });
  await prisma.usageLimit.update({
    where: { userId: user1.id },
    data: { dailyUsed: usageLimitE!.dailyLimit },
  });
  
  const genE_capped = await generate(interviewId_E, token1);
  const questionCount_E_after = await prisma.question.count({ where: { interviewId: interviewId_E } });
  
  // The interview from A/B (which has pending question) must still return 200 reused true
  const genE_reuse = await generate(interviewId_A, token1);
  
  // Restore counters
  await prisma.usageLimit.update({
    where: { userId: user1.id },
    data: { dailyUsed: usageLimit_A?.dailyUsed ?? 1 },
  });
  
  if (
    genE_capped.status === 429 && 
    genE_capped.data?.code === 'USAGE_CAP_EXCEEDED' && 
    genE_capped.data?.scope === 'daily' && 
    genE_capped.data?.resetAt &&
    questionCount_E_after === 0 &&
    genE_reuse.status === 200 && genE_reuse.data?.reused === true
  ) {
    pass('E', `capped=429 USAGE_CAP_EXCEEDED scope=daily resetAt set, no new question, reuse still works (200 reused=true)`);
  } else {
    fail('E', `capped=${genE_capped.status} code=${genE_capped.data?.code} scope=${genE_capped.data?.scope} resetAt=${genE_capped.data?.resetAt} questionCount=${questionCount_E_after}, reuse=${genE_reuse.status} reused=${genE_reuse.data?.reused}`);
  }

  // Restore actual counters properly
  await prisma.usageLimit.update({
    where: { userId: user1.id },
    data: { dailyUsed: 1 }, // restore
  });

  // === Scenario F: Question Limit ===
  console.log('\n--- Scenario F: Question Limit ---');
  // Create interview with limit=1, generate one question, add answer, then try to generate again
  const interviewId_F = await createInterview(token1, 1);
  const genF1 = await generate(interviewId_F, token1);
  
  if (genF1.status !== 201) {
    fail('F', `First generate failed: ${genF1.status} ${JSON.stringify(genF1.data)}`);
  } else {
    // Add an answer to the pending question
    const questionF = await prisma.question.findFirst({ where: { interviewId: interviewId_F } });
    if (questionF) {
      await prisma.answer.create({
        data: { questionId: questionF.id, answerText: 'Test answer' },
      });
    }
    
    const genF2 = await generate(interviewId_F, token1);
    if (genF2.status === 409 && genF2.data?.code === 'QUESTION_LIMIT_REACHED') {
      pass('F', `409 QUESTION_LIMIT_REACHED`);
    } else {
      fail('F', `status=${genF2.status} code=${genF2.data?.code}`);
    }
  }

  // === Scenario G: Rate Limit ===
  console.log('\n--- Scenario G: Rate Limit (25 rapid requests) ---');
  const interviewId_G = await createInterview(token2, 3);
  const responses_G: any[] = [];
  for (let i = 0; i < 25; i++) {
    responses_G.push(await generate(interviewId_G, token2));
  }
  const statuses_G = responses_G.map(r => r.status);
  const rateLimited_G = responses_G.filter(r => r.status === 429 && r.data?.code === 'RATE_LIMITED');
  
  const retryAfterPresent = rateLimited_G.some(r => r.headers?.get?.('retry-after') || Object.keys(r.headers || {}).some(k => k.toLowerCase() === 'retry-after'));
  
  if (rateLimited_G.length > 0 && retryAfterPresent) {
    pass('G', `${rateLimited_G.length} requests rate limited with RATE_LIMITED code and Retry-After header. Statuses: ${[...new Set(statuses_G)].join(',')}`);
  } else {
    fail('G', `rateLimited=${rateLimited_G.length} retryAfterPresent=${retryAfterPresent} statuses=${[...new Set(statuses_G)].join(',')}`);
  }

  console.log('\n=== Verification Complete ===');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Verification script failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
