-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "selo_seq" INTEGER;

-- CreateIndex
CREATE INDEX "audit_log_selo_seq_idx" ON "audit_log"("selo_seq");

-- Registros que já tinham selo foram selados em ordem de id: a posição na cadeia é o próprio id.
UPDATE "audit_log" SET "selo_seq" = "id" WHERE "selo" IS NOT NULL;
