-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "totp_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_segredo" TEXT,
ADD COLUMN     "totp_ultimo_passo" INTEGER;

-- CreateTable
CREATE TABLE "codigo_recuperacao" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigo_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "codigo_recuperacao_usuario_id_idx" ON "codigo_recuperacao"("usuario_id");

-- AddForeignKey
ALTER TABLE "codigo_recuperacao" ADD CONSTRAINT "codigo_recuperacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
