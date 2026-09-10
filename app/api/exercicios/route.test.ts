import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    exercicio: { findUnique: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { POST } from "./route"

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/exercicios", { method: "POST", body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.exercicio.findUnique.mockResolvedValue(null)
})

describe("POST /api/exercicios", () => {
  it("rejeita período vazio sem tocar no banco", async () => {
    const response = await POST(buildRequest({ periodo: "  " }))
    expect(response.status).toBe(400)
    expect(prisma.exercicio.create).not.toHaveBeenCalled()
  })

  it("rejeita período duplicado para a mesma empresa", async () => {
    prisma.exercicio.findUnique.mockResolvedValue({ id: 5, periodo: "1T2026" })
    const response = await POST(buildRequest({ periodo: "1T2026" }))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/já existe/i)
    expect(prisma.exercicio.create).not.toHaveBeenCalled()
  })

  it("cria o exercício e registra auditoria", async () => {
    prisma.exercicio.create.mockResolvedValue({ id: 4, empresaId: 1, periodo: "2T2026", auditado: false })

    const response = await POST(buildRequest({ periodo: "2T2026" }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.periodo).toBe("2T2026")
    expect(prisma.exercicio.create).toHaveBeenCalledWith({ data: { empresaId: 1, periodo: "2T2026" } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ empresaId: 1, acao: "Exercício criado" }) }),
    )
  })

  it("rejeita período acima de 50 caracteres", async () => {
    const response = await POST(buildRequest({ periodo: "a".repeat(51) }))
    expect(response.status).toBe(400)
    expect(prisma.exercicio.create).not.toHaveBeenCalled()
  })

  it("rejeita corpo com JSON malformado", async () => {
    const response = await POST(new Request("http://localhost/api/exercicios", { method: "POST", body: "{ não é json" }))
    expect(response.status).toBe(400)
    expect(prisma.exercicio.create).not.toHaveBeenCalled()
  })

  it("verifica duplicidade com a chave composta empresaId_periodo (não confia só no texto)", async () => {
    prisma.exercicio.create.mockResolvedValue({ id: 4, empresaId: 1, periodo: "2T2026" })
    await POST(buildRequest({ periodo: "2T2026" }))
    expect(prisma.exercicio.findUnique).toHaveBeenCalledWith({
      where: { empresaId_periodo: { empresaId: 1, periodo: "2T2026" } },
    })
  })
})
