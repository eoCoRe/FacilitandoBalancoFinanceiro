import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma, calculo } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    parecer: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  calculo: { calcularParecer: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/server/data/parecer", () => calculo)

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { GET, POST } from "./route"

const post = (body: unknown) => POST(new Request("http://localhost/api/pareceres", { method: "POST", body: JSON.stringify(body) }))

const OPINIAO = {
  rating: "favoravel",
  ratingLabel: "Favorável",
  score: 84,
  suggestedLimit: 250_000,
  limitAvailable: true,
  criteria: [{ label: "Liquidez Corrente", detail: "x", value: "2,00", status: "ok", weight: 0.2, score: 100, insuficiente: false }],
}

const VALIDO = {
  exercicioId: 3,
  valorSolicitado: 200_000,
  decisao: "APROVADO",
  limiteAprovado: 180_000,
  justificativa: "Boa liquidez e margem estável; limite um pouco abaixo do pedido.",
}

const linha = (over: object = {}) => ({
  id: 1,
  exercicio: { periodo: "2025" },
  registradoPor: "admin@teste.com",
  criadoEm: new Date("2026-09-24T12:00:00Z"),
  classificacao: "favoravel",
  score: 84,
  valorSolicitado: 200000,
  limiteSugerido: 250000,
  criterios: [],
  decisao: "APROVADO",
  limiteAprovado: 180000,
  validadeAte: null,
  justificativa: VALIDO.justificativa,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  calculo.calcularParecer.mockResolvedValue({ periodo: "2025", opiniao: OPINIAO })
  prisma.parecer.create.mockImplementation(async () => linha())
})

describe("POST /api/pareceres", () => {
  it("registra a decisão com a análise RECALCULADA no servidor (não a da tela) e audita", async () => {
    const response = await post({ ...VALIDO, classificacao: "favoravel", score: 100 }) // campos extras da tela são ignorados
    expect(response.status).toBe(201)
    expect(calculo.calcularParecer).toHaveBeenCalledWith(1, 3, 200_000)
    expect(prisma.parecer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          empresaId: 1,
          exercicioId: 3,
          registradoPor: "admin@teste.com",
          classificacao: "favoravel",
          score: 84,
          limiteSugerido: 250_000,
          decisao: "APROVADO",
          limiteAprovado: 180_000,
          validadeAte: null,
          criterios: [{ label: "Liquidez Corrente", value: "2,00", status: "ok", weight: 0.2, insuficiente: false }],
        }),
      }),
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Parecer de crédito registrado", detalhe: expect.stringContaining("2025: Aprovado, limite R$ 180.000,00") }),
    })
  })

  it("reprovado: sem limite nem validade, mesmo que a tela mande", async () => {
    await post({ ...VALIDO, decisao: "REPROVADO", limiteAprovado: 999, validadeAte: "2099-01-01" })
    expect(prisma.parecer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ decisao: "REPROVADO", limiteAprovado: null, validadeAte: null }) }),
    )
  })

  it("limite sugerido indisponível (dados insuficientes) é gravado como nulo, não R$ 0", async () => {
    calculo.calcularParecer.mockResolvedValue({ periodo: "2025", opiniao: { ...OPINIAO, suggestedLimit: 0, limitAvailable: false } })
    await post(VALIDO)
    expect(prisma.parecer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ limiteSugerido: null }) }))
  })

  it("validações: decisão, valor, limite, justificativa e validade", async () => {
    const casos = [
      { ...VALIDO, decisao: "TALVEZ" },
      { ...VALIDO, valorSolicitado: 0 },
      { ...VALIDO, limiteAprovado: undefined },
      { ...VALIDO, limiteAprovado: -5 },
      { ...VALIDO, justificativa: "curta" },
      { ...VALIDO, validadeAte: "2020-01-01" }, // passado
      { ...VALIDO, validadeAte: "2026-02-30" }, // não existe
      { ...VALIDO, validadeAte: "2099-01-01" }, // mais de 3 anos
      { ...VALIDO, exercicioId: "3" },
    ]
    for (const corpo of casos) expect((await post(corpo)).status, JSON.stringify(corpo)).toBe(400)
    expect(prisma.parecer.create).not.toHaveBeenCalled()
  })

  it("validade dentro do prazo é gravada como data", async () => {
    const daqui6Meses = new Date()
    daqui6Meses.setUTCMonth(daqui6Meses.getUTCMonth() + 6)
    const texto = daqui6Meses.toISOString().slice(0, 10)
    await post({ ...VALIDO, validadeAte: texto })
    expect(prisma.parecer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ validadeAte: new Date(`${texto}T00:00:00Z`) }) }),
    )
  })

  it("analista não registra (403): a decisão é da alçada de coordenador ou acima", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 3, email: "a@teste.com", nome: "A", papel: "ANALISTA" })
    expect((await post(VALIDO)).status).toBe(403)
    expect(calculo.calcularParecer).not.toHaveBeenCalled()
  })
})

describe("GET /api/pareceres", () => {
  it("histórico da empresa em análise, mais recente primeiro, com valores em número e validade como data", async () => {
    prisma.parecer.findMany.mockResolvedValue([linha({ validadeAte: new Date("2027-03-31T00:00:00Z") })])
    const body = await (await GET()).json()
    expect(prisma.parecer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { empresaId: 1 }, orderBy: { criadoEm: "desc" } }))
    expect(body.pareceres[0]).toMatchObject({ exercicio: "2025", limiteAprovado: 180000, validadeAte: "2027-03-31", decisao: "APROVADO" })
  })
})
