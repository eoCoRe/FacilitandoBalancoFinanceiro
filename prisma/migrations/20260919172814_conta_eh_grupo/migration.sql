-- AlterTable
ALTER TABLE "conta" ADD COLUMN     "eh_grupo" BOOLEAN NOT NULL DEFAULT false;

-- Contas que já têm subcontas são grupos.
UPDATE "conta" SET "eh_grupo" = true WHERE "id" IN (SELECT DISTINCT "conta_pai_id" FROM "conta" WHERE "conta_pai_id" IS NOT NULL);
