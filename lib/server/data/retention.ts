import { prisma } from "@/lib/db"
import { SEAL_LOCK_KEY } from "@/lib/server/audit/audit-seal"

// Prazos padrão — política ainda não fixada pelo negócio (ver SECURITY.md); estes
// defaults são só um ponto de partida defensável, sobrescrevível por variável de
// ambiente sem precisar alterar código.
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 730
export const DEFAULT_EXTRACAO_RETENTION_DAYS = 180

// Teto de 100 anos: um valor absurdo (ex.: 1e12) faria a data de corte cair fora do intervalo que o JavaScript
// representa ("Invalid Date") e o expurgo inteiro falharia. Acima do teto vale o TETO (quem escreve 99999 quer dizer
// "praticamente nunca apagar"; voltar ao padrão de 2 anos apagaria justamente o que ele quis guardar). Valor inválido
// (não numérico, zero ou negativo) volta ao padrão.
export const MAX_RETENTION_DAYS = 36_500

function retentionDaysFromEnv(envVar: string, fallback: number): number {
  const raw = process.env[envVar]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) && parsed !== Infinity) return fallback // NaN
  if (!(parsed > 0)) return fallback
  return Math.min(parsed, MAX_RETENTION_DAYS)
}

function daysBefore(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

export interface PurgeResult {
  auditLogsApagados: number
  extracoesApagadas: number
  tokensApagados: number
}

// Expurgo de dados (LGPD Art. 15/16 — guarda só pelo tempo necessário à finalidade).
// AuditLog e Extracao são as únicas tabelas com política de expurgo definida aqui:
// Empresa/Exercicio/Conta/Valor são o próprio objeto do serviço de análise de crédito
// (retidos enquanto o relacionamento existir, não por prazo fixo). Extracao é apagada em
// cascata com seus ValorExtraido (onDelete: Cascade no schema) — o Valor já confirmado
// na Tabulação não é afetado, só o registro de processamento da extração por IA.
//
// Também limpa os links de recuperação de senha e os códigos de 2 etapas VENCIDOS (token_verificacao):
// já não servem para nada e só acumulariam (hoje só são apagados de passagem quando o mesmo usuário
// pede outro). Não é política de retenção — é higiene, por isso não tem prazo configurável.
export async function purgeExpiredData(now: Date = new Date()): Promise<PurgeResult> {
  const auditLogRetentionDays = retentionDaysFromEnv("AUDIT_LOG_RETENTION_DAYS", DEFAULT_AUDIT_LOG_RETENTION_DAYS)
  const extracaoRetentionDays = retentionDaysFromEnv("EXTRACAO_RETENTION_DAYS", DEFAULT_EXTRACAO_RETENTION_DAYS)

  // A trilha é uma CADEIA de selos (ver audit/audit-seal.ts), na ordem em que foram gerados (selo_seq), que pode ser
  // diferente da ordem das datas (registro confirmado com atraso, ou selado à mão pelo administrador). Apagar por data
  // poderia arrancar um registro do MEIO da cadeia e a verificação acusaria adulteração em dado honesto. Por isso só se
  // apaga um PREFIXO da cadeia: o que vence E está antes do primeiro registro que continua guardado. Um registro velho
  // que ficou depois de um registro ainda dentro do prazo espera o prefixo passar (some no expurgo seguinte).
  // Tudo sob a MESMA trava da selagem: sem ela, um registro sendo selado neste instante (que já leu o "último selado")
  // poderia ficar apontando para um registro que o expurgo acabou de apagar.
  const auditCutoff = daysBefore(auditLogRetentionDays, now)
  const auditLogsApagados = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEAL_LOCK_KEY})::text`
      const primeiroMantido = await tx.auditLog.aggregate({
        _min: { seloSeq: true },
        where: { criadoEm: { gte: auditCutoff }, seloSeq: { not: null } },
      })
      const limiteDaCadeia = primeiroMantido._min.seloSeq
      return tx.auditLog.deleteMany({
        where: {
          criadoEm: { lt: auditCutoff },
          ...(limiteDaCadeia === null ? {} : { OR: [{ selo: null }, { seloSeq: { lt: limiteDaCadeia } }] }),
        },
      })
    },
    { timeout: 120_000, maxWait: 30_000 },
  )
  const extracoesApagadas = await prisma.extracao.deleteMany({
    where: { criadoEm: { lt: daysBefore(extracaoRetentionDays, now) } },
  })

  const tokensApagados = await prisma.tokenVerificacao.deleteMany({ where: { expiraEm: { lt: now } } })

  return {
    auditLogsApagados: auditLogsApagados.count,
    extracoesApagadas: extracoesApagadas.count,
    tokensApagados: tokensApagados.count,
  }
}
