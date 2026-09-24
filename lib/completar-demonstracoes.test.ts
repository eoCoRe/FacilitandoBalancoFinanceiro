import { describe, expect, it } from "vitest"
import { completar, identidadesBalanco, identidadesDre, sinaisDre } from "./completar-demonstracoes"
import type { Account } from "./financial-data"

const dre = identidadesDre()
const m = (o: Record<string, number>) => new Map(Object.entries(o))

describe("DRE: modelos diferentes de documento", () => {
  it("modelo com Bruta e Líquida, sem Deduções: calcula as deduções (negativas)", () => {
    const r = completar(m({ "dre:receita-bruta": 100_777_333.14, "dre=calculada:receita-liquida": 93_701_004.6 }), dre)
    expect(r.valores.get("dre:deducoes")).toBe(-7_076_328.54)
    expect(r.calculados.has("dre:deducoes")).toBe(true)
    expect(r.conflitos).toEqual([])
  })

  it("encadeia: da Receita Líquida e do Lucro Bruto sai o CMV; do Lucro Líquido e do resultado antes do IR sai o IR", () => {
    const r = completar(
      m({
        "dre:receita-bruta": 1000,
        "dre:deducoes": -200,
        "dre=calculada:lucro-bruto": 450,
        "dre=calculada:resultado-antes-ir": 320,
        "dre=calculada:lucro-liquido": 300,
      }),
      dre,
    )
    expect(r.valores.get("dre=calculada:receita-liquida")).toBe(800)
    expect(r.valores.get("dre:cmv")).toBe(-350)
    expect(r.valores.get("dre:ir-csll")).toBe(-20)
  })

  it("os três preenchidos e batendo: nada a apontar; não batendo: aponta a diferença", () => {
    const certo = completar(m({ "dre:receita-bruta": 1000, "dre:deducoes": -200, "dre=calculada:receita-liquida": 800 }), dre)
    expect(certo.conflitos).toEqual([])
    const errado = completar(m({ "dre:receita-bruta": 1000, "dre:deducoes": -200, "dre=calculada:receita-liquida": 850 }), dre)
    expect(errado.conflitos).toEqual([{ total: "dre=calculada:receita-liquida", nome: "Receita Líquida", informado: 850, somaDasPartes: 800 }])
  })

  it("diferença de arredondamento (até 1 unidade) não é conflito", () => {
    const r = completar(m({ "dre:receita-bruta": 1000.4, "dre:deducoes": -200, "dre=calculada:receita-liquida": 800 }), dre)
    expect(r.conflitos).toEqual([])
  })

  it("faltando dois termos, não inventa nada", () => {
    const r = completar(m({ "dre:receita-bruta": 1000 }), dre)
    expect(r.calculados.size).toBe(0)
  })
})

describe("Balanço: total do grupo", () => {
  const contas: Account[] = [
    {
      code: "1",
      name: "Ativo",
      children: [
        {
          code: "1.1",
          name: "Ativo Circulante",
          children: [
            { code: "1.1.1", name: "Disponibilidades", values: {} },
            { code: "1.1.4", name: "Estoques", values: {} },
          ],
        },
        { code: "1.3", name: "Permanente", children: [{ code: "1.3.1", name: "Imobilizado", values: {} }] },
      ],
    },
  ]
  const ids = identidadesBalanco(contas)

  it("gera uma identidade por grupo", () => {
    expect(ids.map((i) => [i.total, i.partes])).toEqual([
      ["1", ["1.1", "1.3"]],
      ["1.1", ["1.1.1", "1.1.4"]],
      ["1.3", ["1.3.1"]],
    ])
  })

  it("total do grupo informado e uma conta em branco: NÃO joga a sobra na conta em branco, aponta quanto sobra", () => {
    // O documento pode ter linhas que o Plano de Contas não tem (ex.: "créditos com partes relacionadas"): a sobra
    // não é necessariamente da conta que ficou em branco.
    const r = completar(m({ "1.1": 5000, "1.1.1": 1200 }), ids)
    expect(r.valores.has("1.1.4")).toBe(false)
    expect(r.conflitos).toEqual([{ total: "1.1", nome: "Ativo Circulante", informado: 5000, somaDasPartes: 1200 }])
  })

  it("todas as contas digitadas e sem total: o sistema calcula o total do grupo (e o do Ativo)", () => {
    const r = completar(m({ "1.1.1": 1200, "1.1.4": 3800, "1.3.1": 900 }), ids)
    expect(r.valores.get("1.1")).toBe(5000)
    expect(r.valores.get("1")).toBe(5900)
    expect(r.calculados).toEqual(new Set(["1.1", "1.3", "1"]))
  })

  it("grupo com todas as contas e o total informado que não bate: conflito com o nome do grupo", () => {
    const r = completar(m({ "1.1": 5000, "1.1.1": 1200, "1.1.4": 3000 }), ids)
    expect(r.conflitos).toEqual([{ total: "1.1", nome: "Ativo Circulante", informado: 5000, somaDasPartes: 4200 }])
  })
})

describe("trava de sinal (a DRE do documento pode ter linhas que o sistema não tem)", () => {
  it("cálculo que daria imposto POSITIVO não é feito: fica em recusados", () => {
    // Caso real: o documento tem "outras receitas operacionais", que a DRE do sistema não tem; o lucro líquido fica
    // maior que o resultado antes do IR calculado, e o IR "daria" positivo.
    const r = completar(m({ "dre=calculada:resultado-antes-ir": 1_128_534.57, "dre=calculada:lucro-liquido": 1_581_390.75 }), dre, {
      sinais: sinaisDre(),
    })
    expect(r.valores.has("dre:ir-csll")).toBe(false)
    expect(r.recusados).toEqual([{ code: "dre:ir-csll", valor: 452_856.18 }])
  })

  it("com o sinal certo, calcula normalmente", () => {
    const r = completar(m({ "dre=calculada:resultado-antes-ir": 320, "dre=calculada:lucro-liquido": 300 }), dre, { sinais: sinaisDre() })
    expect(r.valores.get("dre:ir-csll")).toBe(-20)
    expect(r.recusados).toEqual([])
  })
})
