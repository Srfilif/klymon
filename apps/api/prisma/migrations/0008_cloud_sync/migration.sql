-- CreateTable
CREATE TABLE "cloud_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_documents" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" VARCHAR(160),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_document_versions" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "updatedBy" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_profiles_userId_idx" ON "cloud_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_profiles_userId_name_key" ON "cloud_profiles"("userId", "name");

-- CreateIndex
CREATE INDEX "cloud_documents_profileId_idx" ON "cloud_documents"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_documents_profileId_namespace_key" ON "cloud_documents"("profileId", "namespace");

-- CreateIndex
CREATE INDEX "cloud_document_versions_documentId_idx" ON "cloud_document_versions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_document_versions_documentId_version_key" ON "cloud_document_versions"("documentId", "version");

-- AddForeignKey
ALTER TABLE "cloud_profiles" ADD CONSTRAINT "cloud_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_documents" ADD CONSTRAINT "cloud_documents_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "cloud_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_document_versions" ADD CONSTRAINT "cloud_document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "cloud_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
