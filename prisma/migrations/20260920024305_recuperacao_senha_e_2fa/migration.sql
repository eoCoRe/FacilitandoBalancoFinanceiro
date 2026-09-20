-- CreateEnum
CREATE TYPE "TokenTipo" AS ENUM ('RECUPERACAO_SENHA', 'LOGIN_2FA', 'ATIVACAO_2FA');

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "dois_fatores_ativo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "token_verificacao" (
    "id" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tipo" "TokenTipo" NOT NULL,
    "segredo_hash" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_verificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politica_seguranca" (
    "papel" "Papel" NOT NULL,
    "dois_fatores_obrigatorio" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "politica_seguranca_pkey" PRIMARY KEY ("papel")
);

-- CreateIndex
CREATE INDEX "token_verificacao_usuario_id_tipo_idx" ON "token_verificacao"("usuario_id", "tipo");

-- AddForeignKey
ALTER TABLE "token_verificacao" ADD CONSTRAINT "token_verificacao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
