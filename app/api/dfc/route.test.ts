import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    conta: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/dfc", () => {
  it("retorna as linhas de DFC com os valores por exercício, sem calcular nada", async () => {
    prisma.conta.findMany.mockResolvedValue([
      {
        id: 1,
        codigo: "fluxo-de-caixa-operacional",
        descricao: "Fluxo de Caixa Operacional",
        valores: [
          { valor: 1500, exercicio: { periodo: "4T2024" } },
          { valor: 500, exercicio: { periodo: "1T2026" } },
        ],
      },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.linhas).toHaveLength(1)
    expect(body.linhas[0].valores).toEqual({ "4T2024": 1500, "1T2026": 500 })
    expect(prisma.conta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tipo: "DFC" } }))
  })

  it("retorna lista vazia quando não há contas de DFC cadastradas", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    const response = await GET()
    const body = await response.json()
    expect(body.linhas).toEqual([])
  })
})
