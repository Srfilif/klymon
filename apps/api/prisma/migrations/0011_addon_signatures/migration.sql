-- CreateTable
CREATE TABLE "addon_publisher_keys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "publicKey" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addon_publisher_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addon_publisher_keys_userId_idx" ON "addon_publisher_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "addon_publisher_keys_fingerprint_key" ON "addon_publisher_keys"("fingerprint");

-- AddForeignKey
ALTER TABLE "addon_publisher_keys" ADD CONSTRAINT "addon_publisher_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "addon_versions" ADD COLUMN "signature" VARCHAR(128),
ADD COLUMN "signerFingerprint" VARCHAR(64);
