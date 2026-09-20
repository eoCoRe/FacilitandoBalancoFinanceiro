import { describe, expect, it } from "vitest"
import {
  compareCodes,
  mapAuditoria,
  mapContas,
  mapDfc,
  mapDre,
  mapSnapshot,
  sectorIdFromLabel,
  type ContaNodePayload,
} from "./api-mapping"

const node = (over: Partial<ContaNodePayload> & Pick<ContaNodePayload, "id" | "codigo">): ContaNodePayload => ({
  descricao: `Conta ${over.codigo}`,
  ehGrupo: false,
  valores: {},
  ...over,
})

describe("compareCodes", () => {
  it("ordena por segmento numérico, não por texto", () => {
    expect(["1.10", "1.2", "1.1", "10", "2"].sort(compareCodes)).toEqual(["1.1", "1.2", "1.10", "2", "10"])
  })

  it("põe o pai antes dos filhos", () => {
    expect(compareCodes("1", "1.1")).toBeLessThan(0)
  })
})

describe("mapContas", () => {
  it("vira grupo (children) ou analítica (values) e indexa id por código", () => {
    const { accounts, contaIdByCode } = mapContas([
      node({
        id: 1,
        codigo: "1",
        ehGrupo: true,
        subcontas: [node({ id: 2, codigo: "1.1", valores: { "1T2026": 100 } })],
      }),
    ])

    expect(accounts).toEqual([
      { code: "1", name: "Conta 1", children: [{ code: "1.1", name: "Conta 1.1", values: { "1T2026": 100 } }] },
    ])
    expect(contaIdByCode).toEqual({ "1": 1, "1.1": 2 })
  })

  it("mantém um grupo recém-criado (sem filhas) como grupo, para aceitar subcontas", () => {
    const { accounts } = mapContas([node({ id: 5, codigo: "3", ehGrupo: true })])
    expect(accounts[0]).toEqual({ code: "3", name: "Conta 3", children: [] })
    expect(accounts[0].values).toBeUndefined()
  })

  it("mantém uma analítica sem lançamentos com values vazio (não preenchido ≠ zero)", () => {
    const { accounts } = mapContas([node({ id: 5, codigo: "3" })])
    expect(accounts[0]).toEqual({ code: "3", name: "Conta 3", values: {} })
  })

  it("trata como grupo quem tem subcontas mesmo se ehGrupo vier falso", () => {
    const { accounts } = mapContas([node({ id: 1, codigo: "1", subcontas: [node({ id: 2, codigo: "1.1" })] })])
    expect(accounts[0].children).toHaveLength(1)
  })

  it("ordena filhas e raízes pela ordem numérica dos códigos", () => {
    const { accounts } = mapContas([
      node({ id: 3, codigo: "10" }),
      node({
        id: 1,
        codigo: "2",
        ehGrupo: true,
        subcontas: [node({ id: 4, codigo: "2.10" }), node({ id: 5, codigo: "2.2" })],
      }),
    ])
    expect(accounts.map((a) => a.code)).toEqual(["2", "10"])
    expect(accounts[0].children!.map((a) => a.code)).toEqual(["2.2", "2.10"])
  })
})

describe("mapDre", () => {
  const payload = {
    linhas: [
      { id: "receita-bruta", name: "Receita Bruta", kind: "input" as const, contaId: 10 },
      { id: "receita-liquida", name: "Receita Líquida", kind: "computed" as const, contaId: null },
      { id: "compras", name: "Compras", kind: "input" as const, contaId: 11 },
    ],
    valoresPorExercicio: {
      "1T2026": { "receita-bruta": 6300, "receita-liquida": 5200, compras: undefined },
    },
  }

  it("guarda só linhas de entrada com valor; totalizadores são recalculados na tela", () => {
    expect(mapDre(payload).dreByExercicio).toEqual({ "1T2026": { "receita-bruta": 6300 } })
  })

  it("indexa o id da conta por linha (só as que existem no banco)", () => {
    expect(mapDre(payload).dreContaIdByLine).toEqual({ "receita-bruta": 10, compras: 11 })
  })
})

describe("mapDfc", () => {
  it("aplica o destaque (subtotal/total) pela descrição e usa 'line' para linhas desconhecidas", () => {
    const lines = mapDfc({
      linhas: [
        { id: 1, codigo: "a", descricao: "Fluxo de Caixa Operacional", valores: { "1T2026": 500 } },
        { id: 2, codigo: "b", descricao: "Caixa no Fim do Período", valores: {} },
        { id: 3, codigo: "c", descricao: "Linha nova", valores: {} },
      ],
    })
    expect(lines.map((l) => l.kind)).toEqual(["subtotal", "total", "line"])
    expect(lines[0]).toMatchObject({ name: "Fluxo de Caixa Operacional", values: { "1T2026": 500 } })
  })
})

describe("mapAuditoria", () => {
  it("converte para o formato da tela", () => {
    expect(
      mapAuditoria({ logs: [{ id: 7, usuario: "Sistema", acao: "Valor lançado", detalhe: "x", criadoEm: "2026-09-19T10:00:00.000Z" }] }),
    ).toEqual([{ id: "7", timestamp: "2026-09-19T10:00:00.000Z", user: "Sistema", action: "Valor lançado", detail: "x" }])
  })
})

describe("sectorIdFromLabel", () => {
  it("converte o rótulo gravado no banco no id usado pelas telas", () => {
    expect(sectorIdFromLabel("Indústria de Transformação")).toBe("industria")
  })

  it("cai no setor padrão para rótulo desconhecido ou ausente", () => {
    expect(sectorIdFromLabel("Outro")).toBe("comercio-varejista")
    expect(sectorIdFromLabel(null)).toBe("comercio-varejista")
  })
})

describe("mapSnapshot", () => {
  it("monta o snapshot e o índice de ids a partir das respostas da API", () => {
    const { snapshot, ids } = mapSnapshot({
      empresa: {
        id: 1,
        cnpj: "12.345.678/0001-90",
        razaoSocial: "Farmácia Bem-Estar Ltda",
        setor: "Serviços",
        exercicios: [
          { id: 4, periodo: "4T2024", auditado: false },
          { id: 5, periodo: "1T2025", auditado: false },
        ],
      },
      contas: { contas: [node({ id: 1, codigo: "1" })] },
      dre: { linhas: [], valoresPorExercicio: {} },
      dfc: { linhas: [] },
      auditoria: { logs: [] },
    })

    expect(snapshot).toMatchObject({
      companyName: "Farmácia Bem-Estar Ltda",
      cnpj: "12.345.678/0001-90",
      sectorId: "servicos",
      exercicios: [
        { id: "4T2024", label: "4T2024" },
        { id: "1T2025", label: "1T2025" },
      ],
    })
    expect(ids.exercicioIdByPeriodo).toEqual({ "4T2024": 4, "1T2025": 5 })
    expect(ids.contaIdByCode).toEqual({ "1": 1 })
  })
})
