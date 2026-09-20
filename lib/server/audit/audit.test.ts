import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { auditLog: { create: vi.fn() } },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { logAudit } from "@/lib/server/audit/audit"

beforeEach(() => {
  vi.clearAllMocks()
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
