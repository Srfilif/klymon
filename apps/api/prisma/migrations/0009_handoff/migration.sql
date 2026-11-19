-- CreateTable
CREATE TABLE "handoff_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handoff_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handoff_codes_userId_idx" ON "handoff_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_codes_codeHash_key" ON "handoff_codes"("codeHash");

-- AddForeignKey
ALTER TABLE "handoff_codes" ADD CONSTRAINT "handoff_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "clientSession" BOOLEAN NOT NULL DEFAULT false;
