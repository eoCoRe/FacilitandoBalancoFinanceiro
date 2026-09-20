import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    auditLog: { deleteMany: vi.fn(), aggregate: vi.fn() },
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
  prisma.auditLog.aggregate.mockResolvedValue({ _min: { seloSeq: null } }) // nenhum registro selado dentro do prazo
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

  it("valor absurdo (acima de 100 anos) vale o TETO — nunca o padrão de 2 anos, que apagaria o que a pessoa quis guardar", async () => {
    vi.stubEnv("AUDIT_LOG_RETENTION_DAYS", "99999")
    vi.stubEnv("EXTRACAO_RETENTION_DAYS", "1e12")
    const agora = new Date("2026-09-20T12:00:00Z")
    await purgeExpiredData(agora)
    const dias = (chamada: { where: { criadoEm: { lt: Date } } }) => Math.round((agora.getTime() - chamada.where.criadoEm.lt.getTime()) / 86_400_000)
    const corteAuditoria = prisma.auditLog.deleteMany.mock.calls[0][0]
    const corteExtracao = prisma.extracao.deleteMany.mock.calls[0][0]
    expect(Number.isNaN(corteAuditoria.where.criadoEm.lt.getTime())).toBe(false)
    expect(dias(corteAuditoria)).toBe(MAX_RETENTION_DAYS)
    expect(dias(corteExtracao)).toBe(MAX_RETENTION_DAYS)
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

describe("o expurgo da auditoria só apaga um PREFIXO da cadeia de selos", () => {
  const CORTE = new Date(NOW.getTime() - DEFAULT_AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)

  it("descobre a menor posição (selo_seq) dos registros que continuam guardados", async () => {
    await purgeExpiredData(NOW)
    expect(prisma.auditLog.aggregate).toHaveBeenCalledWith({
      _min: { seloSeq: true },
      where: { criadoEm: { gte: CORTE }, seloSeq: { not: null } },
    })
  })

  it("só apaga o que venceu E está antes do primeiro registro mantido (ou nunca foi selado); o resto espera", async () => {
    prisma.auditLog.aggregate.mockResolvedValue({ _min: { seloSeq: 42 } })
    await purgeExpiredData(NOW)
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { criadoEm: { lt: CORTE }, OR: [{ selo: null }, { seloSeq: { lt: 42 } }] },
    })
  })

  it("sem nenhum registro selado dentro do prazo, tudo o que venceu pode sair (a cadeia inteira é velha)", async () => {
    prisma.auditLog.aggregate.mockResolvedValue({ _min: { seloSeq: null } })
    await purgeExpiredData(NOW)
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({ where: { criadoEm: { lt: CORTE } } })
  })
})
