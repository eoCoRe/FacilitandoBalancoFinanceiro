-- Índice PARCIAL: só os registros ainda sem selo. A selagem roda a cada gravação de auditoria e procura os pendentes
-- (`WHERE selo IS NULL ORDER BY id`); sem este índice o Postgres varreria a tabela inteira toda vez, segurando a trava.
-- O Prisma não modela índice parcial no schema, mas tolera o índice (o diff contra o schema continua vazio).
CREATE INDEX IF NOT EXISTS "audit_log_pendentes_idx" ON "audit_log" ("id") WHERE "selo" IS NULL;
