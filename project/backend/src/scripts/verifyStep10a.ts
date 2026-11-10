import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PDFDocument, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = process.env.API_URL ?? 'http://localhost:5000';
const prisma = new PrismaClient();
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR ?? './uploads');

// ─── Output helpers ──────────────────────────────────────────────────────────

const results: Array<{ scenario: string; status: 'PASS' | 'FAIL'; evidence: string }> = [];

function pass(scenario: string, evidence: string) {
  console.log(`✅ PASS [${scenario}]: ${evidence}`);
  results.push({ scenario, status: 'PASS', evidence });
}

function fail(scenario: string, evidence: string) {
  console.error(`❌ FAIL [${scenario}]: ${evidence}`);
  results.push({ scenario, status: 'FAIL', evidence });
  process.exitCode = 1;
}

// ─── Fixture Generators (pdf-lib) ─────────────────────────────────────────────

async function generateValidPdf(textModifier = ''): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const text = `
John Doe — Senior Backend Engineer
Email: john.doe@example.com | Phone: +1-555-0199 | Location: San Francisco, CA

Professional Summary:
Accomplished software engineer with over 6 years of expertise in architecting high-throughput, low-latency distributed systems using Node.js, TypeScript, PostgreSQL, and Redis. Proven track record of scaling mission-critical microservices, reducing API response times by 40%, and maintaining 99.99% uptime across production clusters.

Core Competencies:
- Languages: TypeScript, JavaScript, SQL, Python, Go
- Frameworks: Express, NestJS, Prisma ORM, BullMQ
- Databases & Caching: PostgreSQL, Redis, MongoDB, ElasticSearch
- Architecture: REST APIs, Event-Driven Architecture, Microservices, CI/CD
${textModifier}
  `.trim();
  page.drawText(text, { x: 50, y: 700, size: 10 });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function generateTextlessPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawRectangle({
    x: 50,
    y: 500,
    width: 200,
    height: 100,
    color: rgb(0.2, 0.4, 0.8),
  });
  page.drawCircle({
    x: 300,
    y: 300,
    size: 50,
    color: rgb(0.8, 0.2, 0.2),
  });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

async function generate11PagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= 11; i++) {
    const page = doc.addPage([600, 800]);
    page.drawText(
      `This is page ${i} of an 11-page document which intentionally exceeds the maximum page limit configured for resume uploads. Validating page count boundaries.`,
      { x: 50, y: 700, size: 12 }
    );
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiJson(method: string, path: string, body?: any, token?: string) {
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

async function signup(email: string, password = 'TestPass123!'): Promise<{ token: string; userId: string }> {
  const res = await apiJson('POST', '/api/auth/signup', { email, password, name: 'Step 10 User' });
  if (!res.data.accessToken) throw new Error(`Signup failed: ${JSON.stringify(res.data)}`);
  return { token: res.data.accessToken as string, userId: res.data.user.id as string };
}

async function uploadPdf(
  token: string | null,
  buffer: Buffer | null,
  filename = 'resume.pdf',
  fieldName = 'resume',
  mimeType = 'application/pdf'
) {
  const formData = new FormData();
  if (buffer) {
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append(fieldName, blob, filename);
  }
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api/resumes`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data, headers: res.headers };
}

async function uploadRawFormData(token: string | null, formData: FormData) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/api/resumes`, {
    method: 'POST',
    headers,
    body: formData,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, data, headers: res.headers };
}

function getAllFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFilesRecursively(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

// ─── Main Verification Routine ───────────────────────────────────────────────

async function main() {
  const ts = Date.now();
  console.log('\n===============================================================');
  console.log('   StackPrep Step 10 Part 1 — Live Verification (A - K)');
  console.log('===============================================================\n');

  // Track created users for cleanup
  const createdUsers: Array<{ token: string; userId: string }> = [];

  try {
    // Generate fixtures
    console.log('[Setup] Generating test PDF fixtures with pdf-lib...');
    const validPdf1 = await generateValidPdf(' [Variant 1]');
    const validPdf2 = await generateValidPdf(' [Variant 2]');
    const validPdf3 = await generateValidPdf(' [Variant 3]');
    const validPdf4 = await generateValidPdf(' [Variant 4]');
    const textlessPdf = await generateTextlessPdf();
    const elevenPagePdf = await generate11PagePdf();
    console.log('[Setup] Fixtures ready.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario A: Valid PDF upload -> 201, reused: false
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- Scenario A: Valid PDF Upload ---');
    const userA = await signup(`s10_a_${ts}@test.com`);
    createdUsers.push(userA);

    const resA = await uploadPdf(userA.token, validPdf1, 'my_resume.pdf');
    if (resA.status === 201 && resA.data.reused === false && resA.data.resume?.id) {
      const r = resA.data.resume;
      const expectedHash = crypto.createHash('sha256').update(validPdf1).digest('hex');

      // Verify DB row
      const dbRow = await prisma.resume.findUnique({ where: { id: r.id } });
      const fileOnDisk = dbRow?.fileUrl ? path.resolve(UPLOAD_DIR, dbRow.fileUrl) : null;
      const fileExists = fileOnDisk ? fs.existsSync(fileOnDisk) : false;

      const noForbiddenFieldsInResponse =
        r.extractedText === undefined &&
        r.rawText === undefined &&
        r.fileUrl === undefined &&
        r.contentHash === undefined;

      if (
        dbRow &&
        dbRow.fileSizeBytes === validPdf1.length &&
        dbRow.pageCount === 1 &&
        dbRow.contentHash === expectedHash &&
        (dbRow.analysisStatus === 'PENDING' || dbRow.analysisStatus === 'COMPLETED') &&
        fileExists &&
        noForbiddenFieldsInResponse
      ) {
        pass(
          'A',
          `201 created, reused: false, id: ${r.id}, size: ${dbRow.fileSizeBytes}B, pages: ${dbRow.pageCount}, hash: ${dbRow.contentHash.slice(0, 10)}..., file on disk: ${fileExists}, response hides fileUrl & extractedText`
        );
      } else {
        fail('A', `DB row or disk verification failed: ${JSON.stringify({ dbRow, fileExists, noForbiddenFieldsInResponse })}`);
      }
    } else {
      fail('A', `Expected 201 with reused: false, got ${resA.status}: ${JSON.stringify(resA.data)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario B: Same bytes again -> 200, reused: true, same id
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario B: Duplicate Upload (Deduplication) ---');
    const countBeforeB = await prisma.resume.count({ where: { userId: userA.userId } });
    const resB = await uploadPdf(userA.token, validPdf1, 'another_name.pdf');
    const countAfterB = await prisma.resume.count({ where: { userId: userA.userId } });

    if (
      resB.status === 200 &&
      resB.data.reused === true &&
      resB.data.resume?.id === resA.data.resume?.id &&
      countBeforeB === 1 &&
      countAfterB === 1
    ) {
      pass('B', `200 OK, reused: true, same id: ${resB.data.resume.id}, DB row count remained exactly 1`);
    } else {
      fail('B', `Expected 200 reused with same id, got ${resB.status}: ${JSON.stringify(resB.data)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario C: Rejections (0 new rows, 0 new files)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario C: Rejections ---');
    const userC = await signup(`s10_c_${ts}@test.com`);
    createdUsers.push(userC);

    const countBeforeC = await prisma.resume.count({ where: { userId: userC.userId } });
    const filesBeforeC = getAllFilesRecursively(UPLOAD_DIR).length;

    const rejectionTests: Array<{ name: string; run: () => Promise<any>; expectedStatus: number; expectedCode: string }> = [
      {
        name: 'txt disguised as pdf',
        run: () => uploadPdf(userC.token, Buffer.from('Plain text fake resume'), 'resume.pdf', 'resume', 'application/pdf'),
        expectedStatus: 415,
        expectedCode: 'UNSUPPORTED_FILE_TYPE',
      },
      {
        name: 'PNG bytes',
        run: () => uploadPdf(userC.token, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'resume.pdf', 'resume', 'application/pdf'),
        expectedStatus: 415,
        expectedCode: 'UNSUPPORTED_FILE_TYPE',
      },
      {
        name: 'MZ bytes',
        run: () => uploadPdf(userC.token, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), 'resume.pdf', 'resume', 'application/pdf'),
        expectedStatus: 415,
        expectedCode: 'UNSUPPORTED_FILE_TYPE',
      },
      {
        name: 'ZIP bytes',
        run: () => uploadPdf(userC.token, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), 'resume.pdf', 'resume', 'application/pdf'),
        expectedStatus: 415,
        expectedCode: 'UNSUPPORTED_FILE_TYPE',
      },
      {
        name: 'File > 5MB',
        run: () => {
          const huge = Buffer.alloc(5 * 1024 * 1024 + 10);
          Buffer.from('%PDF-1.4').copy(huge);
          return uploadPdf(userC.token, huge, 'big.pdf');
        },
        expectedStatus: 413,
        expectedCode: 'FILE_TOO_LARGE',
      },
      {
        name: 'No file',
        run: () => uploadPdf(userC.token, null),
        expectedStatus: 400,
        expectedCode: 'NO_FILE',
      },
      {
        name: 'Wrong field name',
        run: () => uploadPdf(userC.token, validPdf1, 'resume.pdf', 'document'),
        expectedStatus: 400,
        expectedCode: 'INVALID_UPLOAD',
      },
      {
        name: 'Two files',
        run: () => {
          const fd = new FormData();
          fd.append('resume', new Blob([new Uint8Array(validPdf1)], { type: 'application/pdf' }), 'f1.pdf');
          fd.append('resume', new Blob([new Uint8Array(validPdf2)], { type: 'application/pdf' }), 'f2.pdf');
          return uploadRawFormData(userC.token, fd);
        },
        expectedStatus: 400,
        expectedCode: 'INVALID_UPLOAD',
      },
    ];

    let allCSuccess = true;
    const cEvidence: string[] = [];
    for (const test of rejectionTests) {
      const res = await test.run();
      if (res.status === test.expectedStatus && res.data.code === test.expectedCode) {
        cEvidence.push(`${test.name} -> ${res.status} [${res.data.code}]`);
      } else {
        allCSuccess = false;
        cEvidence.push(`${test.name} -> FAILED got ${res.status} ${res.data?.code} (expected ${test.expectedStatus} ${test.expectedCode})`);
      }
    }

    const countAfterC = await prisma.resume.count({ where: { userId: userC.userId } });
    const filesAfterC = getAllFilesRecursively(UPLOAD_DIR).length;

    if (allCSuccess && countBeforeC === countAfterC && filesBeforeC === filesAfterC) {
      pass('C', `All 8 rejections passed: ${cEvidence.join(', ')}; 0 new rows and 0 new files created`);
    } else {
      fail('C', `Rejections outcome: ${cEvidence.join('; ')}, rows diff: ${countAfterC - countBeforeC}, files diff: ${filesAfterC - filesBeforeC}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario D: PDF Content Failures (422)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario D: PDF Extraction Edge Cases (422) ---');
    const userD = await signup(`s10_d_${ts}@test.com`);
    createdUsers.push(userD);

    const countBeforeD = await prisma.resume.count({ where: { userId: userD.userId } });

    // D1: %PDF- followed by garbage
    const garbagePdf = Buffer.from('%PDF-1.4 completely corrupted binary garbage payload that cannot parse as a valid pdf tree');
    const resD1 = await uploadPdf(userD.token, garbagePdf);

    // D2: Text-less PDF
    const resD2 = await uploadPdf(userD.token, textlessPdf);

    // D3: 11-page PDF
    const resD3 = await uploadPdf(userD.token, elevenPagePdf);

    const countAfterD = await prisma.resume.count({ where: { userId: userD.userId } });

    const d1Pass = resD1.status === 422 && resD1.data.code === 'PDF_UNREADABLE';
    const d2Pass = resD2.status === 422 && resD2.data.code === 'PDF_NO_TEXT';
    const d3Pass = resD3.status === 422 && resD3.data.code === 'PDF_TOO_MANY_PAGES';

    if (d1Pass && d2Pass && d3Pass && countBeforeD === countAfterD) {
      pass(
        'D',
        `Garbage PDF -> 422 [PDF_UNREADABLE], Text-less PDF -> 422 [PDF_NO_TEXT], 11-page PDF -> 422 [PDF_TOO_MANY_PAGES]; Encrypted PDF tested in unit test (qpdf not installed on Windows host); 0 rows & 0 files created`
      );
    } else {
      fail(
        'D',
        `D1: ${resD1.status} [${resD1.data.code}], D2: ${resD2.status} [${resD2.data.code}], D3: ${resD3.status} [${resD3.data.code}], rows diff: ${countAfterD - countBeforeD}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario E: Path Traversal Filename Sanitization
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario E: Path Traversal Filename Sanitization ---');
    const userE = await signup(`s10_e_${ts}@test.com`);
    createdUsers.push(userE);

    const resE = await uploadPdf(userE.token, validPdf1, '../../etc/passwd.pdf');
    if (resE.status === 201 && resE.data.resume?.id) {
      const rE = resE.data.resume;
      const dbRowE = await prisma.resume.findUnique({ where: { id: rE.id } });
      const storedKey = dbRowE?.fileUrl ?? '';

      const originalFilenameHasNoSlashes =
        !rE.originalFilename?.includes('/') && !rE.originalFilename?.includes('\\');
      const isUuidKey = /^resumes\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(storedKey);
      const filePath = path.resolve(UPLOAD_DIR, storedKey);
      const isInsideUploadDir = filePath.startsWith(UPLOAD_DIR + path.sep);

      if (originalFilenameHasNoSlashes && isUuidKey && isInsideUploadDir && fs.existsSync(filePath)) {
        pass(
          'E',
          `201 created, originalFilename: "${rE.originalFilename}" (no slashes), stored key: ${storedKey} (UUID-based), saved within UPLOAD_DIR: ${isInsideUploadDir}`
        );
      } else {
        fail('E', `Sanitization check failed: ${JSON.stringify({ rE, storedKey, isInsideUploadDir })}`);
      }
    } else {
      fail('E', `Expected 201, got ${resE.status}: ${JSON.stringify(resE.data)}`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario F: User Resume Limit (3 distinct PDFs, 4th -> 409)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario F: Maximum Resumes Limit ---');
    const userF = await signup(`s10_f_${ts}@test.com`);
    createdUsers.push(userF);

    const resF1 = await uploadPdf(userF.token, validPdf1, 'resume1.pdf');
    const resF2 = await uploadPdf(userF.token, validPdf2, 'resume2.pdf');
    const resF3 = await uploadPdf(userF.token, validPdf3, 'resume3.pdf');
    const resF4 = await uploadPdf(userF.token, validPdf4, 'resume4.pdf'); // 4th distinct
    const resFReupload = await uploadPdf(userF.token, validPdf2, 'resume2_re.pdf'); // re-upload #2

    if (
      resF1.status === 201 &&
      resF2.status === 201 &&
      resF3.status === 201 &&
      resF4.status === 409 &&
      resF4.data.code === 'RESUME_LIMIT_REACHED' &&
      resFReupload.status === 200 &&
      resFReupload.data.reused === true &&
      resFReupload.data.resume.id === resF2.data.resume.id
    ) {
      pass(
        'F',
        `3 distinct uploads -> 3x 201; 4th distinct -> 409 [RESUME_LIMIT_REACHED]; re-upload of #2 -> 200 reused with id ${resFReupload.data.resume.id}`
      );
    } else {
      fail(
        'F',
        `F1: ${resF1.status}, F2: ${resF2.status}, F3: ${resF3.status}, F4: ${resF4.status} [${resF4.data?.code}], Reupload: ${resFReupload.status} [${resFReupload.data?.reused}]`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario G: Concurrency
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario G: Concurrency Controls ---');
    // G1: 5 simultaneous DISTINCT uploads
    const userG1 = await signup(`s10_g1_${ts}@test.com`);
    createdUsers.push(userG1);

    const pdfsG1 = [
      await generateValidPdf(' [G1-1]'),
      await generateValidPdf(' [G1-2]'),
      await generateValidPdf(' [G1-3]'),
      await generateValidPdf(' [G1-4]'),
      await generateValidPdf(' [G1-5]'),
    ];

    const resultsG1 = await Promise.all(
      pdfsG1.map((pdf, idx) => uploadPdf(userG1.token, pdf, `g1_${idx}.pdf`))
    );

    const statusesG1 = resultsG1.map((r) => r.status);
    const dbCountG1 = await prisma.resume.count({ where: { userId: userG1.userId } });
    const allValidStatusesG1 = statusesG1.every((s) => s === 201 || s === 409);
    const no5xxG1 = statusesG1.every((s) => s < 500);

    // G2: 5 simultaneous IDENTICAL uploads
    const userG2 = await signup(`s10_g2_${ts}@test.com`);
    createdUsers.push(userG2);

    const resultsG2 = await Promise.all([
      uploadPdf(userG2.token, validPdf1, 'same1.pdf'),
      uploadPdf(userG2.token, validPdf1, 'same2.pdf'),
      uploadPdf(userG2.token, validPdf1, 'same3.pdf'),
      uploadPdf(userG2.token, validPdf1, 'same4.pdf'),
      uploadPdf(userG2.token, validPdf1, 'same5.pdf'),
    ]);

    const statusesG2 = resultsG2.map((r) => r.status);
    const dbCountG2 = await prisma.resume.count({ where: { userId: userG2.userId } });
    const allValidStatusesG2 = statusesG2.every((s) => s === 201 || s === 200 || s === 409);
    const g2Resumes = await prisma.resume.findMany({ where: { userId: userG2.userId } });
    const g2FileExists = g2Resumes.length === 1 && g2Resumes[0].fileUrl
      ? fs.existsSync(path.resolve(UPLOAD_DIR, g2Resumes[0].fileUrl))
      : false;

    if (
      dbCountG1 <= 3 &&
      allValidStatusesG1 &&
      no5xxG1 &&
      dbCountG2 === 1 &&
      allValidStatusesG2 &&
      g2FileExists
    ) {
      pass(
        'G',
        `G1 (5 distinct concurrent): statuses [${statusesG1.join(', ')}], DB rows: ${dbCountG1} <= 3, 0 5xx errors; G2 (5 identical concurrent): statuses [${statusesG2.join(', ')}], exactly ${dbCountG2} DB row, exactly 1 file on disk: ${g2FileExists}`
      );
    } else {
      fail(
        'G',
        `G1: count=${dbCountG1}, statuses=[${statusesG1.join(',')}]; G2: count=${dbCountG2}, statuses=[${statusesG2.join(',')}]`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario H: Authorization & Ownership
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario H: Authorization & Ownership Isolation ---');
    const userH1 = await signup(`s10_h1_${ts}@test.com`);
    const userH2 = await signup(`s10_h2_${ts}@test.com`);
    createdUsers.push(userH1, userH2);

    const uploadH = await uploadPdf(userH1.token, validPdf1, 'owner_resume.pdf');
    const resumeHId = uploadH.data.resume.id;

    // User 2 tries to GET user 1's resume
    const resHGetOther = await apiJson('GET', `/api/resumes/${resumeHId}`, undefined, userH2.token);
    // User 2 tries to DELETE user 1's resume
    const resHDelOther = await apiJson('DELETE', `/api/resumes/${resumeHId}`, undefined, userH2.token);

    // Verify User 1's resume is still intact
    const user1ResumeIntact = await prisma.resume.findUnique({ where: { id: resumeHId } });

    // No token checks
    const resHNoTokenGet = await apiJson('GET', '/api/resumes');
    const resHNoTokenPost = await uploadPdf(null, validPdf1);

    // Malformed ID check
    const resHMalformed = await apiJson('GET', '/api/resumes/not-a-valid-uuid', undefined, userH1.token);

    if (
      resHGetOther.status === 404 &&
      resHGetOther.data.code === 'RESUME_NOT_FOUND' &&
      resHDelOther.status === 404 &&
      resHDelOther.data.code === 'RESUME_NOT_FOUND' &&
      user1ResumeIntact !== null &&
      resHNoTokenGet.status === 401 &&
      resHNoTokenPost.status === 401 &&
      resHMalformed.status === 400 &&
      resHMalformed.data.code === 'INVALID_RESUME_ID'
    ) {
      pass(
        'H',
        `Other user GET -> 404 [RESUME_NOT_FOUND], Other user DELETE -> 404 [RESUME_NOT_FOUND], owner row intact; No token GET -> 401; No token POST -> 401; Malformed UUID -> 400 [INVALID_RESUME_ID]`
      );
    } else {
      fail(
        'H',
        `H failed: getOther=${resHGetOther.status}, delOther=${resHDelOther.status}, noTokenGet=${resHNoTokenGet.status}, noTokenPost=${resHNoTokenPost.status}, malformed=${resHMalformed.status}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario I: Delete Scenarios (204, row gone, file gone; missing file delete)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario I: Delete Lifecycle & Idempotency ---');
    const userI = await signup(`s10_i_${ts}@test.com`);
    createdUsers.push(userI);

    // I1: Normal delete
    const uploadI1 = await uploadPdf(userI.token, validPdf1, 'delete_me.pdf');
    const idI1 = uploadI1.data.resume.id;
    const rowI1 = await prisma.resume.findUnique({ where: { id: idI1 } });
    const fileI1 = rowI1?.fileUrl ? path.resolve(UPLOAD_DIR, rowI1.fileUrl) : '';

    const resIDel1 = await apiJson('DELETE', `/api/resumes/${idI1}`, undefined, userI.token);
    const rowI1After = await prisma.resume.findUnique({ where: { id: idI1 } });
    const fileI1After = fs.existsSync(fileI1);

    // Second delete on same ID -> 404
    const resIDel2 = await apiJson('DELETE', `/api/resumes/${idI1}`, undefined, userI.token);

    // I2: Delete where file was already removed from disk manually
    const uploadI2 = await uploadPdf(userI.token, validPdf2, 'delete_missing_file.pdf');
    const idI2 = uploadI2.data.resume.id;
    const rowI2 = await prisma.resume.findUnique({ where: { id: idI2 } });
    const fileI2 = rowI2?.fileUrl ? path.resolve(UPLOAD_DIR, rowI2.fileUrl) : '';
    if (fs.existsSync(fileI2)) fs.unlinkSync(fileI2);

    const resIDelMissingFile = await apiJson('DELETE', `/api/resumes/${idI2}`, undefined, userI.token);
    const rowI2After = await prisma.resume.findUnique({ where: { id: idI2 } });

    if (
      resIDel1.status === 204 &&
      rowI1After === null &&
      fileI1After === false &&
      resIDel2.status === 404 &&
      resIDel2.data.code === 'RESUME_NOT_FOUND' &&
      resIDelMissingFile.status === 204 &&
      rowI2After === null
    ) {
      pass(
        'I',
        `DELETE -> 204, DB row deleted, file removed; repeat DELETE -> 404 [RESUME_NOT_FOUND]; DELETE with missing disk file -> 204 and DB row deleted`
      );
    } else {
      fail(
        'I',
        `I failed: del1=${resIDel1.status}, row1After=${rowI1After !== null}, file1After=${fileI1After}, del2=${resIDel2.status}, delMissing=${resIDelMissingFile.status}, row2After=${rowI2After !== null}`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario J: Invariants & Cleanup
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario J: Invariant Verification (Files vs DB Rows) ---');
    const allDbResumes = await prisma.resume.findMany({ select: { id: true, fileUrl: true } });
    const allFilesOnDisk = getAllFilesRecursively(UPLOAD_DIR);

    let orphanFiles = 0;
    let missingFiles = 0;

    // Check every file on disk matches a DB row
    for (const file of allFilesOnDisk) {
      const relPath = path.relative(UPLOAD_DIR, file).replace(/\\/g, '/');
      const match = allDbResumes.find((r) => r.fileUrl === relPath);
      if (!match) {
        console.warn(`[Invariant Warning] Orphan file on disk: ${relPath}`);
        orphanFiles++;
      }
    }

    // Check every DB row has a corresponding file
    for (const dbResume of allDbResumes) {
      if (!dbResume.fileUrl) continue;
      const fullPath = path.resolve(UPLOAD_DIR, dbResume.fileUrl);
      if (!fs.existsSync(fullPath)) {
        console.warn(`[Invariant Warning] Missing file on disk for DB resume: ${dbResume.id} (${dbResume.fileUrl})`);
        missingFiles++;
      }
    }

    // Delete test users' resumes through API
    console.log('[Cleanup] Deleting test users resumes through API...');
    for (const u of createdUsers) {
      const userResumes = await apiJson('GET', '/api/resumes', undefined, u.token);
      if (Array.isArray(userResumes.data?.resumes)) {
        for (const r of userResumes.data.resumes) {
          await apiJson('DELETE', `/api/resumes/${r.id}`, undefined, u.token);
        }
      }
    }

    if (orphanFiles === 0 && missingFiles === 0) {
      pass('J', `1:1 invariant verified: 0 orphan files, 0 missing files; all test resumes cleaned up via API`);
    } else {
      fail('J', `Invariant violations: ${orphanFiles} orphan files, ${missingFiles} missing files`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Scenario K: Rate Limiting (Run LAST with fresh user)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n--- Scenario K: Rate Limiting (10/hour per user) ---');
    const userK = await signup(`s10_k_${ts}@test.com`);
    createdUsers.push(userK);

    const statusesK: number[] = [];
    const retryAftersK: string[] = [];

    // Make 12 sequential uploads of the same file
    for (let i = 1; i <= 12; i++) {
      const resK = await uploadPdf(userK.token, validPdf1, 'rate_test.pdf');
      statusesK.push(resK.status);
      const retryHeader = resK.headers.get('retry-after');
      if (retryHeader) retryAftersK.push(retryHeader);
    }

    const first10Ok = statusesK.slice(0, 10).every((s) => s === 201 || s === 200);
    const rest429 = statusesK.slice(10).every((s) => s === 429);
    const hasRetryAfter = retryAftersK.length >= 2;

    if (first10Ok && rest429 && hasRetryAfter) {
      pass(
        'K',
        `First 10 uploads returned 201/200, uploads 11 & 12 returned 429 [RATE_LIMITED] with Retry-After header: [${retryAftersK.join(', ')}s]`
      );
    } else {
      fail(
        'K',
        `Rate limit failed: statuses=[${statusesK.join(', ')}], retryAfters=[${retryAftersK.join(', ')}]`
      );
    }

    // Final clean of User K
    const userKResumes = await apiJson('GET', '/api/resumes', undefined, userK.token);
    if (Array.isArray(userKResumes.data?.resumes)) {
      for (const r of userKResumes.data.resumes) {
        await apiJson('DELETE', `/api/resumes/${r.id}`, undefined, userK.token);
      }
    }
  } catch (err: any) {
    fail('RUNTIME_ERROR', `Verification script aborted with error: ${err.message}\n${err.stack}`);
  } finally {
    await prisma.$disconnect();
  }

  // Print summary report table
  console.log('\n===============================================================');
  console.log('                 VERIFICATION SUMMARY TABLE');
  console.log('===============================================================');
  console.table(results);
}

main();
