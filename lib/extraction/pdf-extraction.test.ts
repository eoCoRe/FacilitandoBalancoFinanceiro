import { describe, expect, it } from "vitest"
import type { Account } from "../financial-data"
import { detectUnit, extractRowsFromLines, toSystemUnit } from "./pdf-extraction"

function buildAccounts(): Account[] {
  return [
    {
      code: "1",
      name: "Ativo",
      children: [
        { code: "1.1.1", name: "Disponibilidades", values: {} },
        { code: "1.1.3", name: "Contas a Receber de Clientes", values: {} },
      ],
    },
    {
      code: "2",
      name: "Passivo",
      children: [{ code: "2.1.1", name: "Fornecedores", values: {} }],
    },
  ]
}

describe("extractRowsFromLines", () => {
  it("extrai contas reconhecidas com código atribuído", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidades 850,00", page: 1 },
        { text: "1.1.3 Contas a Receber de Clientes 3.200,00", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ code: "1.1.1", value: 850, page: 1 })
    expect(rows[1]).toMatchObject({ code: "1.1.3", value: 3200, page: 1 })
  })

  it("deixa código nulo quando não reconhece a conta, pra revisão manual", () => {
    const rows = extractRowsFromLines([{ text: "Adiantamento a Fornecedores 640,00", page: 2 }], buildAccounts())
    expect(rows).toHaveLength(1)
    expect(rows[0].code).toBeNull()
    expect(rows[0].suggestedName).toBe("Adiantamento a Fornecedores")
  })

  it("ignora linhas sem valor numérico (títulos, cabeçalhos)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "BALANÇO PATRIMONIAL", page: 1 },
        { text: "ATIVO CIRCULANTE", page: 1 },
        { text: "1.1.1 Disponibilidades 850,00", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows).toHaveLength(1)
  })

  it("conta repetida: só a leitura de maior confiança fica COM a conta; a outra continua na lista, sem conta (RF06: nada lido se perde)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidade 850,00", page: 1 }, // singular, casamento mais fraco
        { text: "1.1.1 Disponibilidades 900,00", page: 2 }, // casamento exato
      ],
      buildAccounts(),
    )
    const disponibilidades = rows.filter((r) => r.code === "1.1.1")
    expect(disponibilidades).toHaveLength(1)
    expect(disponibilidades[0].value).toBe(900)

    // a leitura descartada da conta segue na lista: mesmo valor, página e texto originais, mas SEM conta
    expect(rows).toHaveLength(2)
    const perdida = rows.find((r) => r.code === null)!
    expect(perdida).toMatchObject({ value: 850, page: 1, sourceLabel: expect.stringContaining("Disponibilidade") })
    expect(perdida.suggestedName).toBe(perdida.sourceLabel)
  })

  it("conta repetida com a de maior confiança vindo PRIMEIRO: a segunda é que fica sem conta", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidades 900,00", page: 1 },
        { text: "1.1.1 Disponibilidade 850,00", page: 2 },
      ],
      buildAccounts(),
    )
    expect(rows.find((r) => r.code === "1.1.1")!.value).toBe(900)
    expect(rows.find((r) => r.code === null)).toMatchObject({ value: 850, page: 2 })
  })

  it("os ids das linhas continuam únicos (a tela usa o id como chave)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "1.1.1 Disponibilidade 850,00", page: 1 },
        { text: "1.1.1 Disponibilidades 900,00", page: 1 },
        { text: "1.1.1 Disponibilidades 910,00", page: 2 },
      ],
      buildAccounts(),
    )
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  it("cabeçalho com o ano mais recente À ESQUERDA: pega essa coluna, não a última (balanço real: Set/2024 | Dez/2023)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "Descricao da conta----------Sld.de Setembro 2024--Sld.de Dezembro 2023", page: 1 },
        { text: "DISPONIBILIDADES 2.278.211,52 1.431.042,04", page: 1 },
        { text: "CLIENTES 27.003.959,54", page: 1 }, // uma coluna só: fica a única que há
      ],
      buildAccounts(),
    )
    expect(rows.map((r) => [r.code, r.value])).toEqual([
      ["1.1.1", 2278211.52],
      ["1.1.3", 27003959.54],
    ])
  })

  it("o cabeçalho vale só para a própria página: a seguinte, sem anos no cabeçalho, volta à última coluna", () => {
    const rows = extractRowsFromLines(
      [
        { text: "Saldo 2024 Saldo 2023", page: 1 },
        { text: "Disponibilidades 900,00 800,00", page: 1 },
        { text: "Fornecedores 12,06 3.100,00", page: 2 }, // coluna de % antes do valor, como numa DRE
      ],
      buildAccounts(),
    )
    expect(rows.map((r) => r.value)).toEqual([900, 3100])
  })

  it("balancete com passivo em sinal de crédito (\"28.999,50-\"): o passivo entra POSITIVO", () => {
    const rows = extractRowsFromLines(
      [
        { text: "Disponibilidades 1.000,00", page: 1 },
        { text: "Fornecedores 28.999,50-", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows.map((r) => r.value)).toEqual([1000, 28999.5])
  })

  it("passivo já positivo (convenção comum) não tem o sinal mexido", () => {
    const rows = extractRowsFromLines([{ text: "Fornecedores 3.100,00", page: 1 }], buildAccounts())
    expect(rows[0].value).toBe(3100)
  })

  it("seção do documento: 'Fornecedores' no Passivo NÃO Circulante não vira a conta de curto prazo", () => {
    const accounts: Account[] = [
      {
        code: "2",
        name: "Passivo",
        children: [
          { code: "2.1", name: "Passivo Circulante", children: [{ code: "2.1.1", name: "Fornecedores", values: {} }] },
          { code: "2.2", name: "Exigível a Longo Prazo", children: [{ code: "2.2.1", name: "Empréstimos LP", values: {} }] },
        ],
      },
    ]
    const rows = extractRowsFromLines(
      [
        { text: "PASSIVO CIRCULANTE 5.000,00", page: 1 },
        { text: "FORNECEDORES 3.100,00", page: 1 },
        { text: "PASSIVO NÃO CIRCULANTE 900,00", page: 1 },
        { text: "FORNECEDORES 900,00", page: 1 },
      ],
      accounts,
    )
    const fornecedores = rows.filter((r) => r.sourceLabel === "FORNECEDORES")
    expect(fornecedores.map((r) => [r.code, r.value])).toEqual([
      ["2.1.1", 3100],
      [null, 900],
    ])
  })

  it("sem títulos de seção no documento, nada é restringido", () => {
    const rows = extractRowsFromLines([{ text: "Fornecedores 3.100,00", page: 1 }], buildAccounts())
    expect(rows[0].code).toBe("2.1.1")
  })

  it("DRE: linhas de entrada viram 'dre:<linha>', com deduções NEGATIVAS e receita positiva, seja qual for o sinal do PDF", () => {
    const rows = extractRowsFromLines(
      [
        { text: "RECEITA OPERACIONAL BRUTA 100,00 100.777.333,14", page: 4 },
        { text: "DEDUÇÕES DE VENDAS 7.076.328,54", page: 4 },
        { text: "CUSTO SERV./ PRODUTOS VENDIDOS 80,92 81.550.439,82-", page: 4 },
        { text: "DESPESAS OPERACIONAIS (8.809.186,14)", page: 4 },
        { text: "RESULTADO FINANCEIRO 2.212.844,07-", page: 4 },
      ],
      buildAccounts(),
    )
    expect(rows.map((r) => [r.code, r.value])).toEqual([
      ["dre:receita-bruta", 100777333.14],
      ["dre:deducoes", -7076328.54],
      ["dre:cmv", -81550439.82],
      ["dre:despesas-operacionais", -8809186.14],
      ["dre:resultado-financeiro", -2212844.07],
    ])
  })

  it("DRE: linhas CALCULADAS (Receita Líquida, Lucro Bruto...) são reconhecidas mas não recebem conta nem roubam a de entrada", () => {
    const rows = extractRowsFromLines(
      [
        { text: "RECEITA LIQUIDA 93.701.004,60", page: 1 },
        { text: "LUCRO BRUTO 12.150.564,78", page: 1 },
        { text: "LUCRO (PREJUÍZO) LIQUIDO DO EXERCICIO 1.581.390,75", page: 1 },
      ],
      buildAccounts(),
    )
    expect(rows.map((r) => r.code)).toEqual([null, null, null])
  })

  it("retorna lista vazia quando nenhuma linha tem conteúdo extraível", () => {
    expect(extractRowsFromLines([{ text: "BALANÇO PATRIMONIAL", page: 1 }], buildAccounts())).toEqual([])
  })
})

describe("unidade do documento", () => {
  it("detecta documento em milhares pelo cabeçalho; sem aviso, assume reais", () => {
    expect(detectUnit([{ text: "Balanço Patrimonial (Em milhares de reais)" }])).toBe("milhares")
    expect(detectUnit([{ text: "Valores em R$ mil" }])).toBe("milhares")
    expect(detectUnit([{ text: "BALANÇO PATRIMONIAL EXERCICIO 2025" }, { text: "Milhares de coisas" }])).toBe("reais")
  })

  it("converte para milhares com 2 casas (o que o banco guarda); em milhares, não mexe", () => {
    expect(toSystemUnit(12663067.45, "reais")).toBe(12663.07)
    expect(toSystemUnit(-81550439.82, "reais")).toBe(-81550.44)
    expect(toSystemUnit(12663.07, "milhares")).toBe(12663.07)
  })
})

describe("linhas de TOTAL (para conferir e completar a digitação)", () => {
  const contas: Account[] = [
    {
      code: "1",
      name: "Ativo",
      children: [{ code: "1.1", name: "Ativo Circulante", children: [{ code: "1.1.1", name: "Disponibilidades", values: {} }] }],
    },
    {
      code: "2",
      name: "Passivo",
      children: [
        { code: "2.1", name: "Passivo Circulante", children: [{ code: "2.1.1", name: "Fornecedores", values: {} }] },
        { code: "2.2", name: "Exigível a Longo Prazo", children: [{ code: "2.2.1", name: "Empréstimos LP", values: {} }] },
      ],
    },
  ]

  it("total do grupo e da DRE vira totalCode, sem conta (não lança valor)", () => {
    const rows = extractRowsFromLines(
      [
        { text: "ATIVO CIRCULANTE 55.279.398,02", page: 1 },
        { text: "RECEITA LIQUIDA 93.701.004,60", page: 2 },
      ],
      contas,
    )
    expect(rows.map((r) => [r.code, r.totalCode])).toEqual([
      [null, "1.1"],
      [null, "dre=calculada:receita-liquida"],
    ])
  })

  it("'NÃO circulante' não vira o circulante; Passivo Não Circulante é o Exigível a Longo Prazo", () => {
    const rows = extractRowsFromLines(
      [
        { text: "ATIVO NAO CIRCULANTE 877.857,65", page: 1 },
        { text: "PASSIVO NAO CIRCULANTE 2.163.101,57", page: 1 },
      ],
      contas,
    )
    expect(rows.map((r) => r.totalCode)).toEqual([undefined, "2.2"])
  })

  it("balancete com passivo em sinal de crédito: os totais do passivo também ficam positivos", () => {
    const rows = extractRowsFromLines(
      [
        { text: "FORNECEDORES 1.000,00-", page: 1 },
        { text: "PASSIVO CIRCULANTE 1.000,00-", page: 1 },
      ],
      contas,
    )
    expect(rows.map((r) => r.value)).toEqual([1000, 1000])
  })
})
