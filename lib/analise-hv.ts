// Análise vertical (AV) e horizontal (AH) das demonstrações — as duas leituras clássicas da análise de balanços.
// Puro (sem React): a tela Demonstrações escolhe o que mostrar em cada célula.
//
//  - AV: quanto a linha representa do total de referência no MESMO exercício. No Balanço, o total do seu lado
//    (Ativo Total para o ativo; Passivo + PL para o passivo e o PL); na DRE, a Receita Líquida.
//  - AH: quanto a linha variou em relação ao exercício ANTERIOR (o da coluna à esquerda). Sobre o valor absoluto do
//    anterior, para o sinal dizer se subiu ou caiu mesmo quando a linha é negativa (custo, prejuízo).
// Dado que falta, ou base zero, fica sem valor ("—"), nunca vira 0% (RN04).

import { sumAccount, type Account } from "./financial-data"

export type ModoAnalise = "valores" | "av" | "ah"

export function percentual(valor: number | undefined, base: number | undefined): number | undefined {
  if (valor === undefined || base === undefined || base === 0) return undefined
  return (valor / base) * 100
}

export function variacao(atual: number | undefined, anterior: number | undefined): number | undefined {
  if (atual === undefined || anterior === undefined || anterior === 0) return undefined
  return ((atual - anterior) / Math.abs(anterior)) * 100
}

// Base da AV de cada conta do Balanço: o total do grupo raiz a que ela pertence ("1" Ativo, "2" Passivo + PL).
export function basesVerticaisBalanco(accounts: Account[], periodo: string): Map<string, number | undefined> {
  const bases = new Map<string, number | undefined>()
  const visitar = (conta: Account, base: number | undefined) => {
    bases.set(conta.code, base)
    for (const filha of conta.children ?? []) visitar(filha, base)
  }
  for (const raiz of accounts) visitar(raiz, sumAccount(raiz, periodo))
  return bases
}

export function formatPercentual(valor: number | undefined, comSinal = false): string {
  if (valor === undefined || !Number.isFinite(valor)) return "—"
  const texto = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(valor)
  return `${comSinal && valor > 0 ? "+" : ""}${texto}%`
}
