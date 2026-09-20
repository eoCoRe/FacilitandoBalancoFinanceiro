import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    extracao: { findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { GET } from "./route"

const get = (id: string | number) =>
  GET(new Request("http://localhost/api/extracoes/x"), { params: Promise.resolve({ id: String(id) }) })

const extracao = (over = {}) => ({
  id: 7,
  arquivoOrigem: "balanco.pdf",
  modeloLlm: "leitor-pdf-local",
  status: "CONCLUIDA",
  criadoEm: new Date("2026-09-20T12:00:00.000Z"),
  exercicio: { empresaId: 1, periodo: "1T2026" },
  valoresExtraidos: [
    { id: 1, rotuloOrigem: "Disponibilidades", valor: "1100.00", paginaOrigem: 1, confianca: 96, conta: { codigo: "1.1.1", descricao: "Disponibilidades" } },
    { id: 2, rotuloOrigem: "Diversos a classificar", valor: "640", paginaOrigem: 2, confianca: 55, conta: null },
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.extracao.findUnique.mockResolvedValue(extracao())
})

describe("GET /api/extracoes/:id", () => {
  it("devolve cada item lido: texto original, página, confiança e a conta (ou sem conta)", async () => {
    const response = await get(7)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ id: 7, arquivoOrigem: "balanco.pdf", exercicio: "1T2026", modeloLlm: "leitor-pdf-local" })
    expect(body.itens).toEqual([
      { id: 1, rotulo: "Disponibilidades", valor: 1100, pagina: 1, confianca: 96, conta: { codigo: "1.1.1", descricao: "Disponibilidades" } },
      { id: 2, rotulo: "Diversos a classificar", valor: 640, pagina: 2, confianca: 55, conta: null },
    ])
  })

  it("converte o Decimal do banco em número", async () => {
    const body = await (await get(7)).json()
    expect(typeof body.itens[0].valor).toBe("number")
  })

  it("extração antiga, sem rótulo gravado, devolve rotulo null (não quebra)", async () => {
    prisma.extracao.findUnique.mockResolvedValue(
      extracao({ valoresExtraidos: [{ id: 3, rotuloOrigem: null, valor: "10", paginaOrigem: null, confianca: 80, conta: null }] }),
    )
    const body = await (await get(7)).json()
    expect(body.itens[0]).toMatchObject({ rotulo: null, pagina: null })
  })

  it("recusa extração inexistente e extração de exercício de OUTRA empresa", async () => {
    prisma.extracao.findUnique.mockResolvedValue(null)
    expect((await get(99)).status).toBe(400)
    prisma.extracao.findUnique.mockResolvedValue(extracao({ exercicio: { empresaId: 2, periodo: "1T2026" } }))
    expect((await get(7)).status).toBe(400)
  })

  it("recusa id inválido sem consultar o banco", async () => {
    expect((await get("abc")).status).toBe(400)
    expect((await get(0)).status).toBe(400)
    expect(prisma.extracao.findUnique).not.toHaveBeenCalled()
  })

  it("sem login: 401", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await get(7)).status).toBe(401)
    expect(prisma.extracao.findUnique).not.toHaveBeenCalled()
  })
})
