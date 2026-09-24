-- CreateEnum
CREATE TYPE "DecisaoCredito" AS ENUM ('APROVADO', 'APROVADO_COM_RESSALVAS', 'REPROVADO');

-- CreateTable
CREATE TABLE "parecer" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "exercicio_id" INTEGER NOT NULL,
    "registrado_por" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classificacao" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "valor_solicitado" DECIMAL(18,2) NOT NULL,
    "limite_sugerido" DECIMAL(18,2),
    "criterios" JSONB NOT NULL,
    "decisao" "DecisaoCredito" NOT NULL,
    "limite_aprovado" DECIMAL(18,2),
    "validade_ate" DATE,
    "justificativa" TEXT NOT NULL,

    CONSTRAINT "parecer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parecer_empresa_id_criado_em_idx" ON "parecer"("empresa_id", "criado_em");

-- AddForeignKey
ALTER TABLE "parecer" ADD CONSTRAINT "parecer_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parecer" ADD CONSTRAINT "parecer_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "exercicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

