-- CreateEnum
CREATE TYPE "ContaTipo" AS ENUM ('BP', 'DRE', 'DFC');

-- CreateEnum
CREATE TYPE "ExtracaoStatus" AS ENUM ('PENDENTE', 'CONCLUIDA', 'ERRO');

-- CreateTable
CREATE TABLE "empresa" (
    "id" SERIAL NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "setor" TEXT,

    CONSTRAINT "empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercicio" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "auditado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "exercicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conta" (
    "id" SERIAL NOT NULL,
    "conta_pai_id" INTEGER,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "tipo" "ContaTipo" NOT NULL,

    CONSTRAINT "conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valor" (
    "id" SERIAL NOT NULL,
    "exercicio_id" INTEGER NOT NULL,
    "conta_id" INTEGER NOT NULL,
    "valor" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "valor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indice" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "unidade" TEXT NOT NULL,

    CONSTRAINT "indice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracao" (
    "id" SERIAL NOT NULL,
    "exercicio_id" INTEGER NOT NULL,
    "arquivo_origem" TEXT NOT NULL,
    "modelo_llm" TEXT NOT NULL,
    "status" "ExtracaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valor_extraido" (
    "id" SERIAL NOT NULL,
    "extracao_id" INTEGER NOT NULL,
    "conta_id" INTEGER,
    "valor" DECIMAL(18,2) NOT NULL,
    "pagina_origem" INTEGER,
    "confianca" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "valor_extraido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "usuario" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lgpd_erasure_log" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razao_social" TEXT NOT NULL,
    "registros_apagados" JSONB NOT NULL,
    "solicitado_por" TEXT NOT NULL DEFAULT 'Sistema',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lgpd_erasure_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresa_cnpj_key" ON "empresa"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "exercicio_empresa_id_periodo_key" ON "exercicio"("empresa_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "conta_codigo_tipo_key" ON "conta"("codigo", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "valor_exercicio_id_conta_id_key" ON "valor"("exercicio_id", "conta_id");

-- CreateIndex
CREATE UNIQUE INDEX "indice_nome_key" ON "indice"("nome");

-- AddForeignKey
ALTER TABLE "exercicio" ADD CONSTRAINT "exercicio_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conta" ADD CONSTRAINT "conta_conta_pai_id_fkey" FOREIGN KEY ("conta_pai_id") REFERENCES "conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valor" ADD CONSTRAINT "valor_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "exercicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valor" ADD CONSTRAINT "valor_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracao" ADD CONSTRAINT "extracao_exercicio_id_fkey" FOREIGN KEY ("exercicio_id") REFERENCES "exercicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valor_extraido" ADD CONSTRAINT "valor_extraido_extracao_id_fkey" FOREIGN KEY ("extracao_id") REFERENCES "extracao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valor_extraido" ADD CONSTRAINT "valor_extraido_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
