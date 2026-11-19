-- CreateTable
CREATE TABLE "device_codes" (
    "id" UUID NOT NULL,
    "deviceCodeHash" TEXT NOT NULL,
    "userCodeHash" TEXT NOT NULL,
    "userId" UUID,
    "clientName" VARCHAR(80),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "lastPollAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_codes_userId_idx" ON "device_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_deviceCodeHash_key" ON "device_codes"("deviceCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_userCodeHash_key" ON "device_codes"("userCodeHash");

-- AddForeignKey
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
