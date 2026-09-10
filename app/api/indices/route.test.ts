import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    indice: { findMany: vi.fn() },
    exercicio: { findUnique: vi.fn() },
    conta: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { GET } from "./route"

function buildRequest(query = "") {
  return new Request(`http://localhost/api/indices${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.indice.findMany.mockResolvedValue([{ id: 1, nome: "Liquidez Corrente", formula: "...", unidade: "ratio" }])
})

describe("GET /api/indices", () => {
  it("sem exercicioId, devolve só o catálogo", async () => {
    const response = await GET(buildRequest())
    const body = await response.json()

    expect(body.indices).toHaveLength(1)
    expect(body.valores).toBeUndefined()
    expect(prisma.exercicio.findUnique).not.toHaveBeenCalled()
  })

  it("rejeita exercicioId inválido", async () => {
    const response = await GET(buildRequest("?exercicioId=abc"))
    expect(response.status).toBe(400)
  })

  it("rejeita exercicioId de exercício inexistente", async () => {
    prisma.exercicio.findUnique.mockResolvedValue(null)
    const response = await GET(buildRequest("?exercicioId=99"))
    const body = await response.json()
    expect(response.status).toBe(400)
    expect(body.error).toMatch(/não encontrado/i)
  })

  it("calcula os índices do exercício a partir das contas BP e DRE", async () => {
    prisma.exercicio.findUnique.mockResolvedValue({ id: 2, periodo: "1T2026" })
    prisma.conta.findMany.mockImplementation(({ where }: { where: { tipo: string } }) => {
      if (where.tipo === "BP") {
        return Promise.resolve([
          { id: 1, codigo: "1.1", descricao: "Ativo Circulante", contaPaiId: null, valores: [{ valor: 200, exercicio: { periodo: "1T2026" } }] },
          { id: 2, codigo: "2.1", descricao: "Passivo Circulante", contaPaiId: null, valores: [{ valor: 100, exercicio: { periodo: "1T2026" } }] },
        ])
      }
      // DRE completa para 1T2026 (para o lucro líquido resolver de verdade) + uma linha
      // só de outro período (não deve "contaminar" o cálculo de 1T2026) — exercita o
      // `.find()` do período tanto no caminho de achar quanto no de não achar.
      return Promise.resolve([
        {
          id: 3,
          codigo: "receita-bruta",
          valores: [
            { valor: 1000, exercicio: { periodo: "1T2026" } },
            { valor: 500, exercicio: { periodo: "4T2025" } },
          ],
        },
        { id: 4, codigo: "deducoes", valores: [{ valor: -100, exercicio: { periodo: "1T2026" } }] },
        { id: 5, codigo: "cmv", valores: [{ valor: -300, exercicio: { periodo: "1T2026" } }] },
        { id: 6, codigo: "despesas-operacionais", valores: [{ valor: -100, exercicio: { periodo: "1T2026" } }] },
        { id: 7, codigo: "resultado-financeiro", valores: [{ valor: -20, exercicio: { periodo: "1T2026" } }] },
        { id: 8, codigo: "ir-csll", valores: [{ valor: -30, exercicio: { periodo: "1T2026" } }] },
        // conta de DRE sem nenhum lançamento em 1T2026 (só em outro período) — não deve
        // entrar em dreInputs nem quebrar o cálculo.
        { id: 9, codigo: "compras", valores: [{ valor: 999, exercicio: { periodo: "4T2025" } }] },
      ])
    })

    const response = await GET(buildRequest("?exercicioId=2"))
    const body = await response.json()

    expect(body.indices).toHaveLength(1)
    const liquidezCorrente = body.valores.find((v: { id: string }) => v.id === "liquidez-corrente")
    expect(liquidezCorrente.valor).toBe(2)
    // receita-liquida = 1000 - 100 = 900, então margem-líquida agora tem dado real (não null)
    const margemLiquida = body.valores.find((v: { id: string }) => v.id === "margem-liquida")
    expect(margemLiquida.valor).not.toBeNull()
  })

  it("devolve null (não crasha) para índices que dependem da DRE quando não há DRE lançada (RN04)", async () => {
    prisma.exercicio.findUnique.mockResolvedValue({ id: 2, periodo: "1T2026" })
    prisma.conta.findMany.mockResolvedValue([]) // nem BP nem DRE têm conta lançada

    const response = await GET(buildRequest("?exercicioId=2"))
    const body = await response.json()

    expect(response.status).toBe(200)
    const margemLiquida = body.valores.find((v: { id: string }) => v.id === "margem-liquida")
    expect(margemLiquida.valor).toBeNull()
  })
})
