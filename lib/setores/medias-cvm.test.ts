import { describe, expect, it } from "vitest"
import { indicadoresDaEmpresa, mediana, mediasPorSetor, setorDoSistema, usaPlanoPadrao, type ContasEmpresa } from "./medias-cvm"

const DESCRICOES: Record<string, string> = {
  "1.01": "Ativo Circulante",
  "1.01.04": "Estoques",
  "3.01": "Receita de Venda de Bens e/ou Serviços",
}

function empresa(valores: Record<string, number>, descricoes: Record<string, string> = DESCRICOES): ContasEmpresa {
  return { valor: (c) => valores[c], descricao: (c) => descricoes[c] }
}

// Comércio de exemplo (valores em R$ mil).
const LOJA = {
  "1": 1000,
  "1.01": 600,
  "1.01.01": 90,
  "1.01.03": 200,
  "1.01.04": 250,
  "1.02.01": 50,
  "1.02.02": 20,
  "1.02.03": 300,
  "1.02.04": 30,
  "2.01": 400,
  "2.02": 200,
  "2.03": 400,
  "3.01": 1800,
  "3.02": -1260,
  "3.03": 540,
  "3.11": 72,
}

describe("indicadoresDaEmpresa", () => {
  it("calcula os índices do sistema com as contas da DFP", () => {
    const r = indicadoresDaEmpresa(empresa(LOJA))
    expect(r["liquidez-corrente"]).toBe(1.5)
    expect(r["liquidez-seca"]).toBeCloseTo(0.875)
    expect(r["liquidez-geral"]).toBeCloseTo(650 / 600)
    expect(r["liquidez-imediata"]).toBeCloseTo(0.225)
    expect(r["endividamento-geral"]).toBeCloseTo(60)
    expect(r["composicao-endividamento"]).toBeCloseTo((400 / 600) * 100)
    expect(r["imobilizacao-pl"]).toBeCloseTo(87.5)
    expect(r["margem-bruta"]).toBeCloseTo(30)
    expect(r["margem-liquida"]).toBeCloseTo(4)
    expect(r.roe).toBeCloseTo(18)
    expect(r.roa).toBeCloseTo(7.2)
    expect(r["giro-ativo"]).toBeCloseTo(1.8)
    expect(r.pmre).toBeCloseTo((250 / 1260) * 360)
    expect(r.pmrv).toBeCloseTo((200 / 1800) * 360)
  })

  it("PL negativo: sem ROE nem imobilização (seriam números sem sentido); os demais seguem", () => {
    const r = indicadoresDaEmpresa(empresa({ ...LOJA, "2.03": -50 }))
    expect(r.roe).toBeUndefined()
    expect(r["imobilizacao-pl"]).toBeUndefined()
    expect(r["liquidez-corrente"]).toBe(1.5)
  })

  it("sem receita: margens, giro e prazos ficam sem valor, sem dividir por zero", () => {
    const r = indicadoresDaEmpresa(empresa({ ...LOJA, "3.01": 0 }))
    expect(r["margem-bruta"]).toBeUndefined()
    expect(r["giro-ativo"]).toBeUndefined()
    expect(r.pmrv).toBeUndefined()
  })

  it("1.01.04 que não é estoque (outro layout): não é tratado como estoque", () => {
    const r = indicadoresDaEmpresa(empresa(LOJA, { ...DESCRICOES, "1.01.04": "Títulos e Créditos a Receber" }))
    expect(r["liquidez-seca"]).toBe(1.5)
    expect(r.pmre).toBe(0)
  })
})

describe("usaPlanoPadrao", () => {
  it("empresa não financeira: sim; banco (outro plano de contas): não", () => {
    expect(usaPlanoPadrao(empresa(LOJA))).toBe(true)
    expect(usaPlanoPadrao(empresa(LOJA, { "1.01": "Caixa e Equivalentes de Caixa", "3.01": "Receitas de Intermediação Financeira" }))).toBe(false)
  })
})

describe("mediana", () => {
  it("ímpar, par, vazio e valores não finitos", () => {
    expect(mediana([3, 1, 2])).toBe(2)
    expect(mediana([4, 1, 3, 2])).toBe(2.5)
    expect(mediana([])).toBeUndefined()
    expect(mediana([1, Number.NaN, 3, Infinity])).toBe(2)
  })
})

describe("setorDoSistema", () => {
  it("mapeia setores da CVM, inclusive holdings do setor; financeiras e reguladas ficam de fora", () => {
    expect(setorDoSistema("Comércio (Atacado e Varejo)")).toBe("comercio-varejista")
    expect(setorDoSistema("Emp. Adm. Part. - Comércio (Atacado e Varejo)")).toBe("comercio-varejista")
    expect(setorDoSistema("Emp. Adm. Part. - Const. Civil, Mat. Const. e Decoração")).toBe("construcao-civil")
    expect(setorDoSistema("Alimentos")).toBe("industria")
    expect(setorDoSistema("Bancos")).toBeNull()
    expect(setorDoSistema("Energia Elétrica")).toBeNull()
  })
})

describe("mediasPorSetor", () => {
  it("mediana por setor, com o número de empresas e a amostra de cada índice", () => {
    const r = mediasPorSetor([
      { setorCvm: "Comércio (Atacado e Varejo)", contas: empresa({ ...LOJA, "2.01": 300 }) }, // LC 2,0
      { setorCvm: "Comércio (Atacado e Varejo)", contas: empresa(LOJA) }, // LC 1,5
      { setorCvm: "Emp. Adm. Part. - Comércio (Atacado e Varejo)", contas: empresa({ ...LOJA, "2.01": 600, "2.03": -1 }) }, // LC 1,0
      { setorCvm: "Bancos", contas: empresa(LOJA) }, // fora
    ])
    expect(Object.keys(r)).toEqual(["comercio-varejista"])
    expect(r["comercio-varejista"].empresas).toBe(3)
    expect(r["comercio-varejista"].medianas["liquidez-corrente"]).toBe(1.5)
    expect(r["comercio-varejista"].amostras.roe).toBe(2) // a de PL negativo não entra no ROE
  })
})
