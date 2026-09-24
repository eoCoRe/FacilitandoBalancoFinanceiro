-- Uma cadeia de selos por empresa (ver lib/server/audit/audit-seal.ts): a selagem procura o último selo DA EMPRESA e a
-- verificação percorre a cadeia da empresa em ordem de posição. O índice por (empresa, posição) atende as duas.
CREATE INDEX "audit_log_empresa_id_selo_seq_idx" ON "audit_log"("empresa_id", "selo_seq");
