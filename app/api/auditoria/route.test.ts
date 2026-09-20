import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/auditoria", () => {
  it("lista os logs da empresa, mais recentes primeiro", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
    prisma.auditLog.findMany.mockResolvedValue([
      { id: 2, empresaId: 1, usuario: "Renata Alves", acao: "Valor lançado", detalhe: "1.1.1 · 1T2026 = 945" },
    ])

    const response = await GET(new Request("http://localhost/api/auditoria"))
    const body = await response.json()

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { empresaId: 1 }, orderBy: { id: "desc" }, take: 50 }),
    )
    expect(body.logs).toHaveLength(1)
  })

  it("retorna lista vazia quando não há log de auditoria ainda", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
    prisma.auditLog.findMany.mockResolvedValue([])
    const response = await GET(new Request("http://localhost/api/auditoria"))
    const body = await response.json()
    expect(body.logs).toEqual([])
  })

  it("filtra só os logs da empresa (não mistura com outras, caso existam)", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 7 })
    prisma.auditLog.findMany.mockResolvedValue([])
    await GET(new Request("http://localhost/api/auditoria"))
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 7 } }))
  })

  describe("filtros e paginação", () => {
    const get = (query: string) => GET(new Request(`http://localhost/api/auditoria?${query}`))
    const whereUsado = () => prisma.auditLog.findMany.mock.calls[0][0].where

    beforeEach(() => {
      prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
      prisma.auditLog.findMany.mockResolvedValue([])
    })

    it("filtra por usuário (contém, sem diferenciar maiúsculas), ação exata, período e busca livre", async () => {
      await get("usuario=Ana&acao=Valor%20lan%C3%A7ado&de=2026-09-01T00:00:00Z&ate=2026-09-30T23:59:59Z&q=1.1.1")

      expect(whereUsado()).toEqual({
        empresaId: 1,
        usuario: { contains: "Ana", mode: "insensitive" },
        acao: "Valor lançado",
        criadoEm: { gte: new Date("2026-09-01T00:00:00Z"), lte: new Date("2026-09-30T23:59:59Z") },
        OR: [
          { detalhe: { contains: "1.1.1", mode: "insensitive" } },
          { acao: { contains: "1.1.1", mode: "insensitive" } },
          { usuario: { contains: "1.1.1", mode: "insensitive" } },
        ],
      })
    })

    it("texto suspeito segue como VALOR do filtro (parametrizado), nunca vira SQL", async () => {
      await get("usuario=" + encodeURIComponent("'; DROP TABLE audit_log; --"))
      expect(whereUsado().usuario).toEqual({ contains: "'; DROP TABLE audit_log; --", mode: "insensitive" })
    })

    it("cursor pede só o que é mais antigo que o último item recebido", async () => {
      await get("cursor=120")
      expect(whereUsado()).toEqual({ empresaId: 1, id: { lt: 120 } })
    })

    it("devolve proximoCursor quando a página veio cheia, e null quando acabou", async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: 9 }, { id: 8 }])
      expect((await (await get("limite=2")).json()).proximoCursor).toBe(8)

      prisma.auditLog.findMany.mockResolvedValue([{ id: 9 }])
      expect((await (await get("limite=2")).json()).proximoCursor).toBeNull()
    })

    it("limita o tamanho da página a 200", async () => {
      await get("limite=99999")
      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(200)
    })

    it("com opcoes=1 devolve também as ações existentes (filtro da tela)", async () => {
      prisma.auditLog.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ acao: "Login realizado" }, { acao: "Valor lançado" }])
      const body = await (await get("opcoes=1")).json()
      expect(body.acoes).toEqual(["Login realizado", "Valor lançado"])
    })

    it.each([
      ["limite=abc"],
      ["limite=-3"],
      ["cursor=0"],
      ["de=ontem"],
      ["ate=32-13-2026"],
      ["de=2026-09-30&ate=2026-09-01"],
      ["usuario=" + "a".repeat(300)],
      ["q=" + "x".repeat(101)],
    ])("recusa parâmetro inválido (%s) com 400, sem consultar o banco", async (query) => {
      const response = await get(query)
      expect(response.status).toBe(400)
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
    })
  })
})
