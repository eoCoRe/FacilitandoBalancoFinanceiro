import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: { conta: { findMany: vi.fn() } },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { buildBpAccountTree } from "@/lib/server/data/contas"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("buildBpAccountTree", () => {
  it("monta a árvore no formato Account (code/name/values/children) esperado pelo motor de índices", async () => {
    prisma.conta.findMany.mockResolvedValue([
      { id: 1, codigo: "1", descricao: "Ativo", contaPaiId: null, valores: [] },
      {
        id: 2,
        codigo: "1.1",
        descricao: "Ativo Circulante",
        contaPaiId: 1,
        valores: [{ valor: 300, exercicio: { periodo: "1T2026" } }],
      },
    ])

    const [ativo] = await buildBpAccountTree(1)

    expect(ativo).toMatchObject({ code: "1", name: "Ativo" })
    expect(ativo.values).toBeUndefined() // grupo sem lançamento direto
    expect(ativo.children).toHaveLength(1)
    expect(ativo.children![0]).toEqual({ code: "1.1", name: "Ativo Circulante", values: { "1T2026": 300 } })
  })

  it("devolve lista vazia quando não há contas BP cadastradas", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    expect(await buildBpAccountTree(1)).toEqual([])
  })

  it("filtra a busca por tipo BP", async () => {
    prisma.conta.findMany.mockResolvedValue([])
    await buildBpAccountTree(1)
    expect(prisma.conta.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tipo: "BP" } }))
  })

  it("agrega múltiplos exercícios na mesma conta folha", async () => {
    prisma.conta.findMany.mockResolvedValue([
      {
        id: 1,
        codigo: "1.1.1",
        descricao: "Disponibilidades",
        contaPaiId: null,
        valores: [
          { valor: 100, exercicio: { periodo: "4T2024" } },
          { valor: 120, exercicio: { periodo: "1T2025" } },
        ],
      },
    ])

    const [conta] = await buildBpAccountTree(1)
    expect(conta.values).toEqual({ "4T2024": 100, "1T2025": 120 })
  })

  it("ignora conta-pai referenciada que não veio na consulta (órfã)", async () => {
    prisma.conta.findMany.mockResolvedValue([
      { id: 2, codigo: "1.1", descricao: "Ativo Circulante", contaPaiId: 999, valores: [] },
    ])

    const roots = await buildBpAccountTree(1)
    expect(roots).toEqual([]) // não aparece como raiz nem como filha de ninguém
  })
})
