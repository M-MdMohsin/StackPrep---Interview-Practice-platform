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
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data, headers: res.headers };
}

async function signup(email: string, password: string = 'TestPass123!') {
  const res = await apiCall('POST', '/api/auth/signup', { email, password, name: 'Pending User' });
  if (!res.data.accessToken) throw new Error(`Signup failed: ${JSON.stringify(res.data)}`);
  return res.data.accessToken as string;
}

async function createInterview(token: string, questionLimit = 5) {
  const res = await apiCall(
    'POST',
    '/api/interviews',
    {
      role: 'Backend Developer',
      experienceLevel: 'MID',
      interviewType: 'TECHNICAL',
      difficulty: 'MEDIUM',
      questionLimit,
    },
    token
  );
  if (!res.data.interview?.id) throw new Error(`Create interview failed: ${JSON.stringify(res.data)}`);
  return res.data.interview.id as string;
}

async function generateQuestion(interviewId: string, token: string) {
  const res = await apiCall('POST', `/api/interviews/${interviewId}/questions/generate`, undefined, token);
  if (!res.data.question?.id) throw new Error(`Generate question failed: ${JSON.stringify(res.data)}`);
  return res.data.question;
}

async function submitAnswer(questionId: string, answerText: string, token: string) {
  return apiCall('POST', `/api/questions/${questionId}/answers`, { answerText }, token);
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
  console.log('\n====================================================');
  console.log('  StackPrep Step 9 Part 1 (verifyPending.ts)');
  console.log('====================================================\n');

  const validAnswerText =
    'Database indexes structure records on disk using balanced search trees to accelerate search queries from linear scans to logarithmic lookups.';

  // === Scenario P1: Recover answered-but-unevaluated question via /answers ===
  console.log('--- Scenario P1: Answered-without-evaluation -> POST /answers recovers ---');
  const token1 = await signup(`p1_${ts}@test.com`);
  const interviewId_1 = await createInterview(token1, 5);
  const q1 = await generateQuestion(interviewId_1, token1);

  // Insert Answer row via prisma with NO Evaluation
  const insertedAnswer1 = await prisma.answer.create({
    data: {
      questionId: q1.id,
      answerText: 'Initial stored answer text that failed evaluation previously.',
    },
  });

  const resP1 = await submitAnswer(q1.id, 'Resubmitted body text for retry', token1);
  const answerCount1 = await prisma.answer.count({ where: { questionId: q1.id } });
  const evalCount1 = await prisma.evaluation.count({ where: { answer: { questionId: q1.id } } });
  const remainingAnswer1 = await prisma.answer.findFirst({ where: { questionId: q1.id } });

  if (
    resP1.status === 201 &&
    resP1.data.reused === false &&
    answerCount1 === 1 &&
    evalCount1 === 1 &&
    remainingAnswer1?.id === insertedAnswer1.id &&
    resP1.data.answer?.id === insertedAnswer1.id &&
    resP1.data.evaluation?.id
  ) {
    pass(
      'P1',
      `status=201, reused=false, answerId=${remainingAnswer1?.id} (reused existing row), evalCount=1`
    );
  } else {
    fail(
      'P1',
      `status=${resP1.status}, reused=${resP1.data?.reused}, answerCount=${answerCount1}, evalCount=${evalCount1}, answerId=${remainingAnswer1?.id} vs ${insertedAnswer1.id}`
    );
  }

  // === Scenario P2: Answered-without-evaluation -> POST /generate returns it ===
  console.log('\n--- Scenario P2: Answered-without-evaluation -> POST /generate returns reused:true ---');
  const token2 = await signup(`p2_${ts}@test.com`);
  const interviewId_2 = await createInterview(token2, 5);
  const q2 = await generateQuestion(interviewId_2, token2);

  const user2 = await prisma.user.findFirst({ where: { email: `p2_${ts}@test.com` } });
  const usageBefore2 = await prisma.usageLimit.findUnique({ where: { userId: user2!.id } });

  // Insert Answer row via prisma with NO Evaluation
  await prisma.answer.create({
    data: {
      questionId: q2.id,
      answerText: 'Candidate answer awaiting evaluation after network crash.',
    },
  });

  const resP2 = await apiCall('POST', `/api/interviews/${interviewId_2}/questions/generate`, undefined, token2);
  const totalQuestions2 = await prisma.question.count({ where: { interviewId: interviewId_2 } });
  const usageAfter2 = await prisma.usageLimit.findUnique({ where: { userId: user2!.id } });

  if (
    resP2.status === 200 &&
    resP2.data.reused === true &&
    resP2.data.question?.id === q2.id &&
    totalQuestions2 === 1 &&
    usageAfter2?.dailyUsed === usageBefore2?.dailyUsed
  ) {
    pass(
      'P2',
      `status=200, reused=true, same questionId=${resP2.data.question?.id}, totalQuestions=1, usage counter unchanged (${usageAfter2?.dailyUsed})`
    );
  } else {
    fail(
      'P2',
      `status=${resP2.status}, reused=${resP2.data?.reused}, qId=${resP2.data.question?.id} vs ${q2.id}, totalQuestions=${totalQuestions2}, dailyUsed=${usageAfter2?.dailyUsed} vs ${usageBefore2?.dailyUsed}`
    );
  }

  // === Scenario P3: Follow-up question pending check and evaluation ===
  console.log('\n--- Scenario P3: Follow-up-shaped question is pending and answerable ---');
  const token3 = await signup(`p3_${ts}@test.com`);
  const interviewId_3 = await createInterview(token3, 5);
  const q3 = await generateQuestion(interviewId_3, token3);

  // Complete q3 so it is not pending
  const ans3 = await submitAnswer(q3.id, validAnswerText, token3);
  if (ans3.status !== 201) throw new Error(`Failed to complete initial question: ${ans3.status}`);

  // Insert via prisma a follow-up-shaped Question (parentQuestionId = previous, order = previous + 1, source AI_FOLLOW_UP, no answer)
  const followupQ = await prisma.question.create({
    data: {
      interviewId: interviewId_3,
      parentQuestionId: q3.id,
      orderIndex: q3.order + 1,
      source: 'AI_FOLLOW_UP',
      questionText: 'How would you mitigate write amplification when using secondary indexes in PostgreSQL?',
      status: 'PENDING',
    },
  });

  // POST /generate returns the follow-up question
  const resGenP3 = await apiCall('POST', `/api/interviews/${interviewId_3}/questions/generate`, undefined, token3);
  const genReusedP3 = resGenP3.status === 200 && resGenP3.data.reused === true && resGenP3.data.question?.id === followupQ.id;

  // POST /answers to the follow-up succeeds with 201 (NOT 409 QUESTION_NOT_PENDING)
  const resAnsP3 = await submitAnswer(followupQ.id, validAnswerText, token3);
  const evalCount3 = await prisma.evaluation.count({ where: { answer: { questionId: followupQ.id } } });

  if (genReusedP3 && resAnsP3.status === 201 && resAnsP3.data.reused === false && evalCount3 === 1) {
    pass(
      'P3',
      `/generate returned follow-up (200 reused:true), /answers succeeded (201 with Evaluation, not 409)`
    );
  } else {
    fail(
      'P3',
      `genStatus=${resGenP3.status} reused=${resGenP3.data?.reused}, ansStatus=${resAnsP3.status} code=${resAnsP3.data?.code}, evalCount=${evalCount3}`
    );
  }

  // === Scenario P4: Two unanswered questions (n+1 and n+2) -> n+1 gives 409, n+2 gives 201 ===
  console.log('\n--- Scenario P4: Two unanswered questions (orders n+1 and n+2) ---');
  const token4 = await signup(`p4_${ts}@test.com`);
  const interviewId_4 = await createInterview(token4, 5);

  // Directly insert two unanswered questions (orders 1 and 2)
  const qN1 = await prisma.question.create({
    data: {
      interviewId: interviewId_4,
      questionText: 'Question order 1: What is ACID in relational databases?',
      orderIndex: 1,
      status: 'PENDING',
    },
  });
  const qN2 = await prisma.question.create({
    data: {
      interviewId: interviewId_4,
      questionText: 'Question order 2: How does two-phase locking prevent dirty reads?',
      orderIndex: 2,
      status: 'PENDING',
    },
  });

  // Under the highest-order definition, qN2 (order 2) is pending; qN1 (order 1) is not pending
  const resAnsN1 = await submitAnswer(qN1.id, validAnswerText, token4);
  const resAnsN2 = await submitAnswer(qN2.id, validAnswerText, token4);

  if (
    resAnsN1.status === 409 &&
    resAnsN1.data.code === 'QUESTION_NOT_PENDING' &&
    resAnsN2.status === 201 &&
    resAnsN2.data.evaluation?.id
  ) {
    pass(
      'P4',
      `order n+1 returned 409 QUESTION_NOT_PENDING, order n+2 returned 201 with Evaluation`
    );
  } else {
    fail(
      'P4',
      `n+1 status=${resAnsN1.status} code=${resAnsN1.data?.code}, n+2 status=${resAnsN2.status} code=${resAnsN2.data?.code}`
    );
  }

  console.log('\n====================================================');
  console.log('  verifyPending.ts Complete');
  console.log('====================================================\n');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('verifyPending failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
