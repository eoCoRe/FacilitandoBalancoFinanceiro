import { describe, expect, it } from "vitest"
import {
  accountTotalByName,
  applyScale,
  buildSalesOpinion,
  collectLeaves,
  computeDre,
  deltaPercent,
  findAccountByCode,
  findAccountByName,
  flattenAccounts,
  formatBRL,
  formatIndicatorValue,
  formatPercent,
  formatRatio,
  formatScaled,
  indicatorStatus,
  INDICATORS,
  makeIndicatorContext,
  periodsPerYear,
  suggestedCreditLimit,
  sumAccount,
  type Account,
  type DreValues,
  type StaticLine,
} from "./financial-data"

// Árvore mínima só para os testes — não depende dos dados de exemplo do app,
// então continua válida se o Plano de Contas de demonstração mudar.
function buildFixtureAccounts(): Account[] {
  return [
    {
      code: "1",
      name: "Ativo",
      children: [
        {
          code: "1.1",
          name: "Ativo Circulante",
          children: [
            { code: "1.1.1", name: "Disponibilidades", values: { P1: 100, P2: 120 } },
            { code: "1.1.2", name: "Estoques", values: { P1: 200 } }, // sem valor em P2
          ],
        },
      ],
    },
    {
      code: "2",
      name: "Passivo Circulante",
      values: { P1: 250, P2: 300 },
    },
  ]
}

describe("sumAccount", () => {
  it("retorna o valor direto de uma conta folha", () => {
    const [ativo] = buildFixtureAccounts()
    expect(sumAccount(ativo.children![0].children![0], "P1")).toBe(100)
  })

  it("soma os filhos quando todos têm valor no período", () => {
    const [ativo] = buildFixtureAccounts()
    expect(sumAccount(ativo.children![0], "P1")).toBe(300) // 100 + 200
  })

  it("propaga undefined (dados insuficientes) se um filho não tem valor no período", () => {
    const [ativo] = buildFixtureAccounts()
    // Estoques não tem valor em P2 -> grupo inteiro fica indefinido, não "0"
    expect(sumAccount(ativo.children![0], "P2")).toBeUndefined()
  })

  it("retorna undefined para uma folha sem valor no período pedido", () => {
    const [ativo] = buildFixtureAccounts()
    expect(sumAccount(ativo.children![0].children![1], "P2")).toBeUndefined()
  })

  it("retorna undefined para um nó sem values e sem children (nó incompleto/malformado)", () => {
    expect(sumAccount({ code: "x", name: "Nó vazio" }, "P1")).toBeUndefined()
  })
})

describe("findAccountByName / findAccountByCode / accountTotalByName", () => {
  const accounts = buildFixtureAccounts()

  it("encontra uma conta pelo nome em qualquer nível da árvore", () => {
    expect(findAccountByName(accounts, "Disponibilidades")?.code).toBe("1.1.1")
  })

  it("encontra uma conta pelo código", () => {
    expect(findAccountByCode(accounts, "1.1")?.name).toBe("Ativo Circulante")
  })

  it("retorna undefined para conta inexistente", () => {
    expect(findAccountByName(accounts, "Não existe")).toBeUndefined()
    expect(accountTotalByName(accounts, "Não existe", "P1")).toBeUndefined()
  })

  it("findAccountByCode retorna undefined quando o código não existe", () => {
    expect(findAccountByCode(accounts, "9.9")).toBeUndefined()
  })

  it("soma pelo nome, propagando dados insuficientes", () => {
    expect(accountTotalByName(accounts, "Ativo Circulante", "P1")).toBe(300)
    expect(accountTotalByName(accounts, "Ativo Circulante", "P2")).toBeUndefined()
  })
})

describe("collectLeaves / flattenAccounts", () => {
  const accounts = buildFixtureAccounts()

  it("coleta só as contas com valores (folhas)", () => {
    const leaves = collectLeaves(accounts)
    expect(leaves.map((a) => a.code).sort()).toEqual(["1.1.1", "1.1.2", "2"])
  })

  it("achata preservando a profundidade de cada nó", () => {
    const flat = flattenAccounts(accounts)
    const byCode = Object.fromEntries(flat.map((r) => [r.account.code, r.depth]))
    expect(byCode["1"]).toBe(0)
    expect(byCode["1.1"]).toBe(1)
    expect(byCode["1.1.1"]).toBe(2)
    expect(byCode["2"]).toBe(0)
  })
})

describe("computeDre", () => {
  it("encadeia os totalizadores corretamente a partir das entradas", () => {
    const inputs: DreValues = {
      "receita-bruta": 1000,
      deducoes: -100,
      cmv: -400,
      "despesas-operacionais": -200,
      "resultado-financeiro": -50,
      "ir-csll": -60,
    }
    const dre = computeDre(inputs)
    expect(dre["receita-liquida"]).toBe(900) // 1000 - 100
    expect(dre["lucro-bruto"]).toBe(500) // 900 - 400
    expect(dre["ebit"]).toBe(300) // 500 - 200
    expect(dre["resultado-antes-ir"]).toBe(250) // 300 - 50
    expect(dre["lucro-liquido"]).toBe(190) // 250 - 60
  })

  it("propaga undefined (RN04) quando falta algum insumo", () => {
    const dre = computeDre({ "receita-bruta": 1000 }) // sem deduções
    expect(dre["receita-liquida"]).toBeUndefined()
    expect(dre["lucro-bruto"]).toBeUndefined()
    expect(dre["lucro-liquido"]).toBeUndefined()
  })

  it("repassa a linha informativa 'compras' sem alterá-la", () => {
    const dre = computeDre({ compras: 500 })
    expect(dre.compras).toBe(500)
  })
})

describe("applyScale / formatBRL / formatScaled / formatRatio / formatPercent", () => {
  it("converte a escala corretamente (valores em milhares)", () => {
    expect(applyScale(1000, "milhares")).toBe(1000)
    expect(applyScale(1000, "unidade")).toBe(1_000_000)
    expect(applyScale(1000, "milhoes")).toBe(1)
  })

  it("formata em pt-BR (vírgula decimal, separador de milhar)", () => {
    expect(formatBRL(1234.5, 2)).toBe("1.234,50")
    expect(formatBRL(1234, 0)).toBe("1.234")
  })

  it("formatScaled mostra travessão para valor indefinido (dados insuficientes)", () => {
    expect(formatScaled(undefined, "milhares")).toBe("—")
    expect(formatScaled(1000, "milhares")).toBe("1.000")
  })

  it("formatScaled usa 2 casas decimais na escala 'milhões'", () => {
    expect(formatScaled(1_000_000, "milhoes")).toBe("1.000,00")
  })

  it("formatRatio e formatPercent usam as casas decimais esperadas", () => {
    expect(formatRatio(1.5)).toBe("1,50")
    expect(formatPercent(54.678)).toBe("54,7%")
  })
})

describe("formatIndicatorValue", () => {
  const ratioIndicator = INDICATORS.find((i) => i.unit === "ratio")!
  const percentIndicator = INDICATORS.find((i) => i.unit === "percent")!
  const diasIndicator = INDICATORS.find((i) => i.unit === "dias")!

  it("mostra 'Dados insuficientes' para valor indefinido, independente da unidade", () => {
    expect(formatIndicatorValue(ratioIndicator, undefined)).toBe("Dados insuficientes")
  })

  it("formata cada unidade no padrão certo", () => {
    expect(formatIndicatorValue(ratioIndicator, 1.5)).toBe("1,50")
    expect(formatIndicatorValue(percentIndicator, 12.34)).toBe("12,3%")
    expect(formatIndicatorValue(diasIndicator, 45.6)).toBe("46 dias")
  })
})

describe("deltaPercent", () => {
  it("calcula a variação percentual normal", () => {
    expect(deltaPercent(110, 100)).toBeCloseTo(10)
    expect(deltaPercent(90, 100)).toBeCloseTo(-10)
  })

  it("retorna undefined se faltar algum valor ou o anterior for zero", () => {
    expect(deltaPercent(undefined, 100)).toBeUndefined()
    expect(deltaPercent(100, undefined)).toBeUndefined()
    expect(deltaPercent(100, 0)).toBeUndefined()
  })
})

describe("indicatorStatus", () => {
  const higherIsBetter = INDICATORS.find((i) => i.id === "liquidez-corrente")! // thresholds 1.5 / 1.0
  const lowerIsBetter = INDICATORS.find((i) => i.id === "endividamento-geral")! // thresholds 50 / 70

  it("indisponível para valor indefinido, NaN ou infinito", () => {
    expect(indicatorStatus(higherIsBetter, undefined)).toBe("indisponivel")
    expect(indicatorStatus(higherIsBetter, Number.NaN)).toBe("indisponivel")
    expect(indicatorStatus(higherIsBetter, Number.POSITIVE_INFINITY)).toBe("indisponivel")
  })

  it("classifica corretamente quando maior é melhor", () => {
    expect(indicatorStatus(higherIsBetter, 2.0)).toBe("ok")
    expect(indicatorStatus(higherIsBetter, 1.2)).toBe("atencao")
    expect(indicatorStatus(higherIsBetter, 0.5)).toBe("risco")
  })

  it("classifica corretamente quando menor é melhor", () => {
    expect(indicatorStatus(lowerIsBetter, 40)).toBe("ok")
    expect(indicatorStatus(lowerIsBetter, 60)).toBe("atencao")
    expect(indicatorStatus(lowerIsBetter, 90)).toBe("risco")
  })
})

describe("motor de índices (INDICATORS + makeIndicatorContext)", () => {
  it("calcula Liquidez Corrente a partir do Plano de Contas", () => {
    const accounts: Account[] = [
      { code: "1.1", name: "Ativo Circulante", values: { P1: 300 } },
      { code: "2.1", name: "Passivo Circulante", values: { P1: 150 } },
    ]
    const ctx = makeIndicatorContext(accounts, computeDre({}), "P1")
    const liquidezCorrente = INDICATORS.find((i) => i.id === "liquidez-corrente")!
    expect(liquidezCorrente.compute(ctx)).toBe(2)
  })

  it("retorna undefined quando a conta usada na fórmula não existe no período (RN04)", () => {
    const accounts: Account[] = [{ code: "1.1", name: "Ativo Circulante", values: {} }]
    const ctx = makeIndicatorContext(accounts, computeDre({}), "P1")
    const liquidezCorrente = INDICATORS.find((i) => i.id === "liquidez-corrente")!
    expect(liquidezCorrente.compute(ctx)).toBeUndefined()
  })

  it("calcula Liquidez Seca com a subtração real (Ativo Circulante − Estoques), não só o caminho de dado insuficiente", () => {
    const accounts: Account[] = [
      { code: "1.1", name: "Ativo Circulante", values: { P1: 800 } },
      { code: "1.1.4", name: "Estoques", values: { P1: 200 } },
      { code: "2.1", name: "Passivo Circulante", values: { P1: 400 } },
    ]
    const ctx = makeIndicatorContext(accounts, computeDre({}), "P1")
    const liquidezSeca = INDICATORS.find((i) => i.id === "liquidez-seca")!
    expect(liquidezSeca.compute(ctx)).toBe(1.5) // (800 - 200) / 400
  })

  it("calcula os prazos médios (PMRE/PMRV/PMPC) multiplicando a razão por 360 dias", () => {
    const accounts: Account[] = [
      { code: "1.1.4", name: "Estoques", values: { P1: 300 } },
      { code: "1.1.3", name: "Contas a Receber de Clientes", values: { P1: 250 } },
      { code: "2.1.1", name: "Fornecedores", values: { P1: 400 } },
    ]
    const dre = computeDre({ "receita-bruta": 1000, cmv: -600, compras: 800 })
    const ctx = makeIndicatorContext(accounts, dre, "P1")

    expect(INDICATORS.find((i) => i.id === "pmre")!.compute(ctx)).toBe(180) // (300/600)*360
    expect(INDICATORS.find((i) => i.id === "pmrv")!.compute(ctx)).toBe(90) // (250/1000)*360
    expect(INDICATORS.find((i) => i.id === "pmpc")!.compute(ctx)).toBe(180) // (400/800)*360
  })
})

// ---- Opinião de Venda (parecer de crédito) ----
// Fixture de uma empresa saudável: liquidez > 1,5, endividamento < 50%, margem > 5%.
function healthyAccounts(): Account[] {
  return [
    { code: "1", name: "Ativo", values: { P0: 2500, P1: 3000 } },
    { code: "1.1", name: "Ativo Circulante", values: { P0: 900, P1: 1000 } },
    { code: "2.1", name: "Passivo Circulante", values: { P0: 500, P1: 500 } },
    { code: "2.2", name: "Exigível a Longo Prazo", values: { P0: 300, P1: 300 } },
    { code: "2.3", name: "Patrimônio Líquido", values: { P0: 1700, P1: 2000 } },
  ]
}

function healthyDreByExercicio(): Record<string, DreValues> {
  return {
    P0: { "receita-bruta": 1000, deducoes: -200, cmv: -350, "despesas-operacionais": -100, "resultado-financeiro": -30, "ir-csll": -20 },
    // receitaLiquida=800, lucroBruto=450, ebit=350, antesIr=320, lucroLiquido=300
    P1: { "receita-bruta": 1200, deducoes: -200, cmv: -400, "despesas-operacionais": -100, "resultado-financeiro": -50, "ir-csll": -50 },
    // receitaLiquida=1000, lucroBruto=600, ebit=500, antesIr=450, lucroLiquido=400
  }
}

const healthyDfc: StaticLine[] = [{ name: "Fluxo de Caixa Operacional", values: { P0: 250, P1: 300 }, kind: "subtotal" }]

describe("suggestedCreditLimit", () => {
  it("usa o menor entre 25% da receita anualizada, 120% do PL e 3x o caixa operacional anualizado", () => {
    const dre = computeDre(healthyDreByExercicio().P1) // receita-liquida: 1000, lucro-liquido: 400
    // "P1" é um exercício anual: candidatos (em milhares) 1000*0.25=250 | 2000*1.2=2400 | 300*3=900 -> menor é 250
    const limit = suggestedCreditLimit(healthyAccounts(), dre, healthyDfc, "P1")
    expect(limit).toBe(250_000) // milhares -> reais
  })

  it("exercício trimestral ('1T2025') anualiza receita e caixa por 4; semestral ('1S2025'), por 2", () => {
    const trimestre: Account[] = [{ code: "2.3", name: "Patrimônio Líquido", values: { "1T2025": 2000, "1S2025": 2000 } }]
    const dfc: StaticLine[] = [{ name: "Fluxo de Caixa Operacional", values: { "1T2025": 300, "1S2025": 300 }, kind: "subtotal" }]
    const dre = computeDre({ "receita-bruta": 1000, deducoes: 0 }) // receita líquida 1000
    expect(suggestedCreditLimit(trimestre, dre, dfc, "1T2025")).toBe(1_000_000) // 1000*4*0.25
    expect(suggestedCreditLimit(trimestre, dre, dfc, "1S2025")).toBe(500_000) // 1000*2*0.25
    expect(periodsPerYear("2025")).toBe(1)
  })

  it("dado que falta fica de fora (não vira zero): sem DFC, vale o menor entre receita e PL", () => {
    const dre = computeDre(healthyDreByExercicio().P1)
    expect(suggestedCreditLimit(healthyAccounts(), dre, [], "P1")).toBe(250_000)
    // Só com o PL
    expect(suggestedCreditLimit(healthyAccounts(), computeDre({}), [], "P1")).toBe(2_400_000)
  })

  it("sem nenhum dado: undefined (dados insuficientes), não R$ 0", () => {
    expect(suggestedCreditLimit([], computeDre({}), [], "P1")).toBeUndefined()
  })

  it("nunca retorna negativo mesmo com PL ou caixa operacional negativos", () => {
    const accounts: Account[] = [{ code: "2.3", name: "Patrimônio Líquido", values: { P1: -500 } }]
    const dfc: StaticLine[] = [{ name: "Fluxo de Caixa Operacional", values: { P1: -100 }, kind: "subtotal" }]
    const dre = computeDre({ "receita-bruta": 100 })
    const limit = suggestedCreditLimit(accounts, dre, dfc, "P1")
    expect(limit).toBe(0)
  })
})

describe("buildSalesOpinion", () => {
  it("dá parecer favorável para uma empresa saudável, com valor solicitado dentro do limite", () => {
    const opinion = buildSalesOpinion(healthyAccounts(), healthyDreByExercicio(), healthyDfc, "P1", "P0", 200_000)

    expect(opinion.rating).toBe("favoravel")
    expect(opinion.score).toBeGreaterThanOrEqual(70)
    expect(opinion.criteria.find((c) => c.label === "Liquidez Corrente")?.status).toBe("ok")
    expect(opinion.criteria.find((c) => c.label === "Margem Líquida")?.status).toBe("ok")
    // lucro cresceu de 300 (P0) para 400 (P1) -> tendência positiva
    expect(opinion.criteria.find((c) => c.label === "Tendência do Lucro")?.status).toBe("ok")
    expect(opinion.coverage).toBeGreaterThanOrEqual(1) // 200k cabe no limite sugerido (250k)
    expect(opinion.narrative.some((n) => n.includes("cabe dentro"))).toBe(true)
  })

  it("dá parecer desfavorável para uma empresa com liquidez, endividamento e margem ruins", () => {
    const weakAccounts: Account[] = [
      { code: "1", name: "Ativo", values: { P1: 1000 } },
      { code: "1.1", name: "Ativo Circulante", values: { P1: 200 } },
      { code: "2.1", name: "Passivo Circulante", values: { P1: 800 } }, // liquidez 0,25 -> risco
      { code: "2.2", name: "Exigível a Longo Prazo", values: { P1: 700 } }, // endividamento ~150% -> risco
      { code: "2.3", name: "Patrimônio Líquido", values: { P1: 100 } },
    ]
    const weakDre: Record<string, DreValues> = {
      P1: { "receita-bruta": 1000, deducoes: -100, cmv: -850, "despesas-operacionais": -100, "resultado-financeiro": -50, "ir-csll": 0 },
      // receitaLiquida=900, lucroBruto=50, ebit=-50, antesIr=-100, lucroLiquido=-100 -> margem negativa
    }
    const weakDfc: StaticLine[] = [{ name: "Fluxo de Caixa Operacional", values: { P1: -50 }, kind: "subtotal" }]

    const opinion = buildSalesOpinion(weakAccounts, weakDre, weakDfc, "P1", undefined, 1_000_000)

    expect(opinion.rating).toBe("desfavoravel")
    expect(opinion.score).toBeLessThan(45)
    expect(opinion.criteria.find((c) => c.label === "Liquidez Corrente")?.status).toBe("risco")
    expect(opinion.criteria.find((c) => c.label === "Margem Líquida")?.status).toBe("risco")
    expect(opinion.narrative.some((n) => n.includes("dificuldade"))).toBe(true)
  })

  it("recomenda reduzir o valor quando o pedido excede o limite sugerido", () => {
    const opinion = buildSalesOpinion(healthyAccounts(), healthyDreByExercicio(), healthyDfc, "P1", "P0", 50_000_000)
    expect(opinion.coverage).toBeLessThan(1)
    expect(opinion.narrative.some((n) => n.includes("maior do que a empresa consegue sustentar"))).toBe(true)
  })

  it("sem período anterior, não afirma tendência — pede para informar o valor quando requestedValue é zero", () => {
    const opinion = buildSalesOpinion(healthyAccounts(), healthyDreByExercicio(), healthyDfc, "P1", undefined, 0)
    expect(opinion.narrative.some((n) => n.includes("Ainda não há período anterior"))).toBe(true)
    expect(opinion.narrative.some((n) => n.includes("Informe o valor pedido"))).toBe(true)
  })

  it("classifica como 'ressalvas' quando os critérios ficam todos na faixa intermediária (atenção)", () => {
    const accounts: Account[] = [
      { code: "1", name: "Ativo", values: { P1: 3000 } },
      { code: "1.1", name: "Ativo Circulante", values: { P1: 600 } },
      { code: "2.1", name: "Passivo Circulante", values: { P1: 500 } },
      { code: "2.2", name: "Exigível a Longo Prazo", values: { P1: 1300 } },
      { code: "2.3", name: "Patrimônio Líquido", values: { P1: 700 } },
    ]
    const dreByExercicio: Record<string, DreValues> = {
      P1: {
        "receita-bruta": 1030,
        deducoes: -30,
        cmv: -600,
        "despesas-operacionais": -350,
        "resultado-financeiro": -10,
        "ir-csll": -10,
      },
      // receitaLiquida=1000, lucroBruto=400, ebit=50, antesIr=40, lucroLiquido=30 -> margem 3%
    }

    const opinion = buildSalesOpinion(accounts, dreByExercicio, healthyDfc, "P1", undefined, 0)

    expect(opinion.rating).toBe("ressalvas")
    expect(opinion.score).toBeGreaterThanOrEqual(45)
    expect(opinion.score).toBeLessThan(70)
    expect(opinion.criteria.find((c) => c.label === "Liquidez Corrente")?.status).toBe("atencao")
    expect(opinion.criteria.find((c) => c.label === "Endividamento")?.status).toBe("atencao")
    // texto de "atenção" (faixa intermediária) das narrativas de liquidez e endividamento
    expect(opinion.narrative.some((n) => n.includes("com pouca margem"))).toBe(true)
    expect(opinion.narrative.some((n) => n.includes("pede atenção"))).toBe(true)
  })

  it("não crasha e aplica os defaults (0) quando faltam contas, DFC e o período anterior tabulado", () => {
    // accounts/dfc vazios e dreByExercicio sem a chave do período anterior — exercita
    // todos os `?? 0`/`?.` defensivos de suggestedCreditLimit e buildSalesOpinion.
    const opinion = buildSalesOpinion([], {}, [], "P1", "P0", 0)

    expect(opinion.suggestedLimit).toBe(0)
    expect(opinion.coverage).toBe(0)
    expect(["favoravel", "ressalvas", "desfavoravel"]).toContain(opinion.rating)
    expect(opinion.criteria).toHaveLength(5)
  })

  it("narrativa aponta queda de lucro (não crescimento) quando o resultado recua frente ao período anterior", () => {
    const dreByExercicio: Record<string, DreValues> = {
      ...healthyDreByExercicio(),
      P0: { "receita-bruta": 1500, deducoes: -200, cmv: -400, "despesas-operacionais": -100, "resultado-financeiro": -30, "ir-csll": -20 },
      // P0: lucroLiquido=750, bem maior que o lucroLiquido=400 de P1 -> tendência negativa
    }

    const opinion = buildSalesOpinion(healthyAccounts(), dreByExercicio, healthyDfc, "P1", "P0", 500_000)

    const tendencia = opinion.criteria.find((c) => c.label === "Tendência do Lucro")!
    expect(tendencia.value.startsWith("-")).toBe(true)
    expect(opinion.narrative.some((n) => n.includes("recuou"))).toBe(true)
  })
})

describe("buildSalesOpinion — dados insuficientes (RN04)", () => {
  it("critério sem dado aparece como 'Dados insuficientes' e o parecer não pode ser favorável", () => {
    // Só o balanço, sem DRE: margem, tendência e parte do limite ficam sem dado.
    const opinion = buildSalesOpinion(healthyAccounts(), {}, [], "P1", "P0", 100_000)
    const margem = opinion.criteria.find((c) => c.label === "Margem Líquida")!
    expect(margem).toMatchObject({ value: "Dados insuficientes", insuficiente: true, status: "atencao" })
    expect(opinion.criteria.find((c) => c.label === "Liquidez Corrente")?.insuficiente).toBe(false)
    expect(opinion.rating).not.toBe("favoravel")
    expect(opinion.headline).toMatch(/Faltam dados/)
    expect(opinion.narrative.some((n) => n.includes("Não há dados suficientes"))).toBe(true)
  })

  it("sem dado nenhum para o limite: limitAvailable falso, e a narrativa diz por quê (não 'limite R$ 0')", () => {
    const opinion = buildSalesOpinion([], {}, [], "P1", undefined, 100_000)
    expect(opinion.limitAvailable).toBe(false)
    expect(opinion.suggestedLimit).toBe(0)
    expect(opinion.narrative.some((n) => n.includes("para calcular um limite sugerido"))).toBe(true)
  })
})
