-- AlterTable
ALTER TABLE "addon_versions" ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
