-- CreateTable
CREATE TABLE "addons" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "summary" VARCHAR(280) NOT NULL,
    "description" TEXT,
    "authorId" UUID NOT NULL,
    "visibility" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_versions" (
    "id" UUID NOT NULL,
    "addonId" VARCHAR(64) NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "mcVersions" TEXT[],
    "loaders" TEXT[],
    "dependencies" JSONB NOT NULL DEFAULT '[]',
    "downloadUrl" VARCHAR(2048) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "changelog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addon_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addons_authorId_idx" ON "addons"("authorId");

-- CreateIndex
CREATE INDEX "addon_versions_addonId_idx" ON "addon_versions"("addonId");

-- CreateIndex
CREATE UNIQUE INDEX "addon_versions_addonId_version_key" ON "addon_versions"("addonId", "version");

-- AddForeignKey
ALTER TABLE "addons" ADD CONSTRAINT "addons_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_versions" ADD CONSTRAINT "addon_versions_addonId_fkey" FOREIGN KEY ("addonId") REFERENCES "addons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

