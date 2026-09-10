import { prisma } from "@/lib/db"

// Prazos padrão — política ainda não fixada pelo negócio (ver SECURITY.md); estes
// defaults são só um ponto de partida defensável, sobrescrevível por variável de
// ambiente sem precisar alterar código.
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 730
export const DEFAULT_EXTRACAO_RETENTION_DAYS = 180

function retentionDaysFromEnv(envVar: string, fallback: number): number {
  const raw = process.env[envVar]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function daysBefore(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export interface PurgeResult {
  auditLogsApagados: number
  extracoesApagadas: number
}

// Expurgo de dados (LGPD Art. 15/16 — guarda só pelo tempo necessário à finalidade).
// AuditLog e Extracao são as únicas tabelas com política de expurgo definida aqui:
// Empresa/Exercicio/Conta/Valor são o próprio objeto do serviço de análise de crédito
// (retidos enquanto o relacionamento existir, não por prazo fixo). Extracao é apagada em
// cascata com seus ValorExtraido (onDelete: Cascade no schema) — o Valor já confirmado
// na Tabulação não é afetado, só o registro de processamento da extração por IA.
export async function purgeExpiredData(now: Date = new Date()): Promise<PurgeResult> {
  const auditLogRetentionDays = retentionDaysFromEnv("AUDIT_LOG_RETENTION_DAYS", DEFAULT_AUDIT_LOG_RETENTION_DAYS)
  const extracaoRetentionDays = retentionDaysFromEnv("EXTRACAO_RETENTION_DAYS", DEFAULT_EXTRACAO_RETENTION_DAYS)

  const auditLogsApagados = await prisma.auditLog.deleteMany({
    where: { criadoEm: { lt: daysBefore(auditLogRetentionDays, now) } },
  })
  const extracoesApagadas = await prisma.extracao.deleteMany({
    where: { criadoEm: { lt: daysBefore(extracaoRetentionDays, now) } },
  })

  return { auditLogsApagados: auditLogsApagados.count, extracoesApagadas: extracoesApagadas.count }
}
