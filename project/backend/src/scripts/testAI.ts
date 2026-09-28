// ============================================================
// testAI.ts — standalone smoke-test for the AI provider layer
// Run with: npx ts-node src/scripts/testAI.ts
// ============================================================

// Load .env FIRST — before any other imports that might read env vars
import 'dotenv/config';

import { AIService } from '../services/ai.service';

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  StackPrep AI Service — Complete Suite');
  console.log('========================================\n');

  // 1. Question Generation
  console.log('--- 1. Testing generateQuestion ---');
  const questionResult = await AIService.generateQuestion({
    role: 'Backend Developer',
    experienceLevel: 'MID',
    interviewType: 'TECHNICAL',
    difficulty: 'MEDIUM',
    topic: 'Database Indexing',
  });
  console.log('Data:', JSON.stringify(questionResult.data, null, 2));
  console.log('Meta:', JSON.stringify(questionResult.meta, null, 2));
  const question = questionResult.data;

  // 2. Answer Evaluation
  console.log('\n--- 2. Testing evaluateAnswer ---');
  const evaluationResult = await AIService.evaluateAnswer({
    questionText: question.questionText,
    answerText: 'A B-tree index keeps data sorted and allows searches, sequential access, insertions, and deletions in logarithmic time. It reduces disk I/O by having high branching factor.',
    role: 'Backend Developer',
    difficulty: 'MEDIUM',
  });
  console.log('Data:', JSON.stringify(evaluationResult.data, null, 2));
  console.log('Meta:', JSON.stringify(evaluationResult.meta, null, 2));
  const evaluation = evaluationResult.data;

  // 3. Follow-up Question
  console.log('\n--- 3. Testing generateFollowUp ---');
  const followUpResult = await AIService.generateFollowUp({
    originalQuestion: question.questionText,
    answerText: 'A B-tree index keeps data sorted and allows searches in logarithmic time.',
    evaluation,
  });
  console.log('Data:', JSON.stringify(followUpResult.data, null, 2));
  console.log('Meta:', JSON.stringify(followUpResult.meta, null, 2));

  // 4. Resume Analysis
  console.log('\n--- 4. Testing analyzeResume ---');
  const resumeResult = await AIService.analyzeResume({
    resumeText: `
      John Doe — Senior Backend Engineer
      Experience: 4 years at Acme Corp building distributed microservices in Node.js, Go, and PostgreSQL.
      Projects: Built high-throughput payment gateway processing 10k RPS with Redis caching and Kafka.
      Skills: TypeScript, Node.js, PostgreSQL, Redis, Kafka, Docker, Kubernetes, AWS.
      Education: B.S. in Computer Science from State University, 2020.
    `,
  });
  console.log('Data:', JSON.stringify(resumeResult.data, null, 2));
  console.log('Meta:', JSON.stringify(resumeResult.meta, null, 2));

  // 5. Report Generation
  console.log('\n--- 5. Testing generateReport ---');
  const reportResult = await AIService.generateReport({
    interviewSummary: 'Candidate answered 3 questions on Databases and System Design. Strong understanding of indexing and caching, but struggled with distributed consensus and replication lag.',
  });
  console.log('Data:', JSON.stringify(reportResult.data, null, 2));
  console.log('Meta:', JSON.stringify(reportResult.meta, null, 2));

  // 6. Vector Embedding
  console.log('\n--- 6. Testing generateEmbedding ---');
  const embedding = await AIService.generateEmbedding('Software engineer with experience in distributed databases.');
  console.log(`Result: Successfully generated vector with length: ${embedding.length}`);
  console.log('Sample dimensions:', embedding.slice(0, 5));

  console.log('\n========================================');
  console.log('  All 6 operations passed successfully! ✓');
  console.log('========================================\n');
}

main().catch((err: unknown) => {
  console.error('\n[testAI] FAILED:', err);
  process.exit(1);
});
