import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { auditLog: { create: vi.fn() }, empresa: { findFirst: vi.fn() } },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { logAudit, logAuditSafe } from "@/lib/server/audit/audit"
import { sealOwn } from "@/lib/server/audit/audit-seal"

beforeEach(() => {
  vi.clearAllMocks()
  prisma.auditLog.create.mockResolvedValue({ id: 77 })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

describe("logAudit", () => {
  it("usa 'Sistema' como usuário padrão (sem autenticação ainda — RNF02)", async () => {
    await logAudit(1, "Valor lançado", "1.1.1 · 1T2026 = 945")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { empresaId: 1, usuario: "Sistema", acao: "Valor lançado", detalhe: "1.1.1 · 1T2026 = 945" },
    })
  })

  it("aceita um usuário explícito, sobrescrevendo o padrão", async () => {
    await logAudit(1, "Conta criada", "detalhe", "Renata Alves")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: { empresaId: 1, usuario: "Renata Alves", acao: "Conta criada", detalhe: "detalhe" },
    })
  })
})

describe("logAudit + selagem (a ligação entre os dois)", () => {
  it("sela EXATAMENTE o registro que acabou de gravar (o id vem do create), depois de gravar", async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 123 })
    await logAudit(1, "Valor lançado", "x")
    expect(sealOwn).toHaveBeenCalledTimes(1)
    expect(sealOwn).toHaveBeenCalledWith(123)
    expect(prisma.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sealOwn).mock.invocationCallOrder[0])
  })

  it("se a selagem falhar, o registro JÁ gravado é devolvido e a ação não é recusada (o erro vai para o log)", async () => {
    vi.mocked(sealOwn).mockRejectedValueOnce(new Error("banco indisponível"))
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    const row = await logAudit(1, "Valor lançado", "x")
    expect(row).toEqual({ id: 77 })
    expect(aviso.mock.calls.map((c) => String(c[0])).some((l) => l.includes("audit.seal.failed"))).toBe(true)
    aviso.mockRestore()
  })

  it("não sela nada quando a gravação do registro falha (e o erro sobe para quem chamou)", async () => {
    prisma.auditLog.create.mockRejectedValueOnce(new Error("sem banco"))
    await expect(logAudit(1, "x", "y")).rejects.toThrow("sem banco")
    expect(sealOwn).not.toHaveBeenCalled()
  })
})

describe("logAuditSafe", () => {
  it("grava com o e-mail (cortado em 254) e também sela", async () => {
    await logAuditSafe("Login realizado", "detalhe", "a".repeat(300))
    expect(prisma.auditLog.create.mock.calls[0][0].data.usuario).toHaveLength(254)
    expect(sealOwn).toHaveBeenCalledWith(77)
  })

  it("engole o erro (não pode mascarar o resultado de quem chamou) MAS deixa uma linha de log com a causa", async () => {
    prisma.auditLog.create.mockRejectedValueOnce(Object.assign(new Error("banco fora"), { code: "P1001" }))
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(logAuditSafe("Login recusado", "d", "a@b.com")).resolves.toBeUndefined()
    const linha = aviso.mock.calls.map((c) => String(c[0])).find((l) => l.includes("audit.write_failed"))!
    expect(linha).toContain("Login recusado")
    expect(linha).not.toContain("banco fora") // só nome e código do erro, nunca a mensagem
    aviso.mockRestore()
  })

  it("sem empresa cadastrada: não grava nem lança", async () => {
    prisma.empresa.findFirst.mockResolvedValue(null)
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(logAuditSafe("x", "y", "a@b.com")).resolves.toBeUndefined()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    aviso.mockRestore()
  })
})

