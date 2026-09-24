import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { empresa: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() } },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"
import { POST } from "./selecionar/route"

const selecionar = (body: unknown) =>
  POST(new Request("http://localhost/api/empresas/selecionar", { method: "POST", body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/empresas", () => {
  it("lista as empresas em ordem alfabética e diz qual está escolhida", async () => {
    prisma.empresa.findMany.mockResolvedValue([
      { id: 2, cnpj: "11.222.333/0001-81", razaoSocial: "Alfa Ltda", setor: "Serviços" },
      { id: 1, cnpj: "12.345.678/0001-90", razaoSocial: "Beta SA", setor: null },
    ])
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })

    const body = await (await GET()).json()
    expect(body.empresas.map((e: { id: number }) => e.id)).toEqual([2, 1])
    expect(body.atualId).toBe(1)
    expect(prisma.empresa.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { razaoSocial: "asc" } }))
  })
})

describe("POST /api/empresas/selecionar", () => {
  it("empresa existente: grava o cookie de escolha (httpOnly)", async () => {
    prisma.empresa.findUnique.mockResolvedValue({ id: 2, razaoSocial: "Alfa Ltda" })
    const response = await selecionar({ id: 2 })
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toMatch(/cb_empresa=2;.*HttpOnly/i)
  })

  it("empresa que não existe: 400 e nenhum cookie", async () => {
    prisma.empresa.findUnique.mockResolvedValue(null)
    const response = await selecionar({ id: 99 })
    expect(response.status).toBe(400)
    expect(response.headers.get("set-cookie")).toBeNull()
  })

  it("id inválido: 400 sem consultar o banco", async () => {
    for (const id of ["2", -1, 1.5, null]) expect((await selecionar({ id })).status).toBe(400)
    expect(prisma.empresa.findUnique).not.toHaveBeenCalled()
  })
})
