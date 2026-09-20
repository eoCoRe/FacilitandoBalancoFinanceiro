import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    auditLog: { deleteMany: vi.fn() },
    extracao: { deleteMany: vi.fn() },
    tokenVerificacao: { deleteMany: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { DEFAULT_AUDIT_LOG_RETENTION_DAYS, DEFAULT_EXTRACAO_RETENTION_DAYS, MAX_RETENTION_DAYS, purgeExpiredData } from "@/lib/server/data/retention"

const NOW = new Date("2026-06-01T00:00:00.000Z")

beforeEach(() => {
  vi.clearAllMocks()
  prisma.auditLog.deleteMany.mockResolvedValue({ count: 0 })
  prisma.extracao.deleteMany.mockResolvedValue({ count: 0 })
  prisma.tokenVerificacao.deleteMany.mockResolvedValue({ count: 0 })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("purgeExpiredData", () => {
  it("usa os prazos padrão (730 dias para auditoria, 180 para extração) sem variável de ambiente", async () => {
    await purgeExpiredData(NOW)

    const auditCutoff = new Date(NOW.getTime() - DEFAULT_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const extracaoCutoff = new Date(NOW.getTime() - DEFAULT_EXTRACAO_RETENTION_DAYS * 24 * 60 * 60 * 1000)

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: auditCutoff } } })
    expect(prisma.extracao.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: extracaoCutoff } } })
  })

  it("respeita AUDIT_LOG_RETENTION_DAYS / EXTRACAO_RETENTION_DAYS quando configuradas", async () => {
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "30")
    vi.stubEnv("EXTRACAO_RETENTION_DAYS", "10")

    await purgeExpiredData(NOW)

    const auditCutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000)
    const extracaoCutoff = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: auditCutoff } } })
    expect(prisma.extracao.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: extracaoCutoff } } })
  })

  it("ignora valor de ambiente inválido (não numérico ou <= 0) e usa o padrão", async () => {
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "abacate")
    vi.stubEnv("EXTRACAO_RETENTION_DAYS", "-5")

    await purgeExpiredData(NOW)

    const auditCutoff = new Date(NOW.getTime() - DEFAULT_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const extracaoCutoff = new Date(NOW.getTime() - DEFAULT_EXTRACAO_RETENTION_DAYS * 24 * 60 * 60 * 1000)

    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: auditCutoff } } })
    expect(prisma.extracao.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: extracaoCutoff } } })
  })

  it("valor absurdo (acima de 100 anos) também cai no padrão, em vez de gerar data inválida e derrubar o expurgo", async () => {
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "1e12")
    vi.stubEnv("EXTRACAO_RETENTION_DAYS", String(MAX_RETENTION_DAYS + 1))
    const agora = new Date("2026-09-20T12:00:00Z")
    await purgeExpiredData(agora)
    const corteAuditoria = prisma.auditLog.deleteMany.mock.calls[0][0].where.criadoEm.lt as Date
    expect(Number.isNaN(corteAuditoria.getTime())).toBe(false)
    expect(Math.round((agora.getTime() - corteAuditoria.getTime()) / 86_400_000)).toBe(DEFAULT_AUDIT_LOG_RETENTION_DAYS)
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", String(MAX_RETENTION_DAYS))
    await purgeExpiredData(agora) // o próprio teto é aceito
    expect(Number.isNaN((prisma.auditLog.deleteMany.mock.calls[1][0].where.criadoEm.lt as Date).getTime())).toBe(false)
  })

  it("devolve a contagem de registros apagados", async () => {
    prisma.auditLog.deleteMany.mockResolvedValue({ count: 12 })
    prisma.extracao.deleteMany.mockResolvedValue({ count: 3 })
    prisma.tokenVerificacao.deleteMany.mockResolvedValue({ count: 7 })

    const result = await purgeExpiredData(NOW)

    expect(result).toEqual({ auditLogsApagados: 12, extracoesApagadas: 3, tokensApagados: 7 })
  })

  it("apaga só os tokens JÁ vencidos (expiraEm < agora), nunca um link/código ainda válido", async () => {
    await purgeExpiredData(NOW)

    expect(prisma.tokenVerificacao.deleteMany).toHaveBeenCalledTimes(1)
    expect(prisma.tokenVerificacao.deleteMany).toHaveBeenCalledWith({ where: { expiraEm: { lt: NOW } } })
  })
})
