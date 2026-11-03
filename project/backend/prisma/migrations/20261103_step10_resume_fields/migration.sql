-- Step 10: Add ResumeAnalysisStatus enum and new fields to Resume table

-- CreateEnum
CREATE TYPE "ResumeAnalysisStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable: add Step 10 columns to Resume
ALTER TABLE "Resume"
  ADD COLUMN "originalFilename"   TEXT,
  ADD COLUMN "fileSizeBytes"      INTEGER,
  ADD COLUMN "pageCount"          INTEGER,
  ADD COLUMN "contentHash"        TEXT,
  ADD COLUMN "parsedEducation"    JSONB,
  ADD COLUMN "parsedTechnologies" JSONB,
  ADD COLUMN "analysisStatus"     "ResumeAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "analysisError"      TEXT,
  ADD COLUMN "guardrailFlagged"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "analyzedAt"         TIMESTAMP(3);

-- AlterTable: add remaining columns to Question that were in the current schema but not in init migration
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "category"     TEXT,
  ADD COLUMN IF NOT EXISTS "questionType" TEXT,
  ADD COLUMN IF NOT EXISTS "source"       TEXT;

-- AlterTable: add remaining columns to UsageLimit
ALTER TABLE "UsageLimit"
  ADD COLUMN IF NOT EXISTS "dailyLimit"    INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "monthlyLimit"  INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "dailyUsed"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monthlyUsed"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyResetAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "monthlyResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: unique constraint allowing NULL repetition (Postgres NULL != NULL so nulls repeat fine)
CREATE UNIQUE INDEX "Resume_userId_contentHash_key" ON "Resume"("userId", "contentHash");

-- CreateIndex: existing schema constraints that weren't in init
CREATE UNIQUE INDEX IF NOT EXISTS "PromptVersion_task_versionLabel_provider_model_key" ON "PromptVersion"("task", "versionLabel", "provider", "model");
DROP INDEX IF EXISTS "PromptVersion_task_versionLabel_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Question_interviewId_orderIndex_key" ON "Question"("interviewId", "orderIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "Question_parentQuestionId_key" ON "Question"("parentQuestionId");
