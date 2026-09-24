// Casa o rótulo lido do PDF com uma conta do Plano de Contas, sem depender de LLM:
// normalização + um pequeno dicionário de sinônimos comuns + distância de edição.

import type { Account } from "../financial-data"

// Nomes alternativos comuns em outros sistemas contábeis para as mesmas contas do
// Plano de Contas padrão desta aplicação. Lista pequena de propósito: cresce conforme
// documentos reais forem testados, não tenta cobrir tudo de uma vez.
const SYNONYMS: Record<string, string> = {
  "caixa e equivalentes de caixa": "disponibilidades",
  "caixa e bancos": "disponibilidades",
  caixa: "disponibilidades",
  "duplicatas a receber": "contas a receber de clientes",
  clientes: "contas a receber de clientes",
  "fornecedores a pagar": "fornecedores",
  "emprestimos bancarios": "emprestimos e financiamentos",
  financiamentos: "emprestimos e financiamentos",
  "patrimonio liquido total": "patrimonio liquido",
  // Vistos em balanços reais de escritórios de contabilidade (2024/2025).
  disponivel: "disponibilidades",
  "caixa e bancos conta movimento": "disponibilidades",
  "creditos de clientes": "contas a receber de clientes",
  "clientes a receber": "contas a receber de clientes",
  "estoque de mercadorias": "estoques",
  "estoques de mercadorias": "estoques",
  "mercadorias para revenda": "estoques",
  "impostos a recolher": "obrigacoes tributarias",
  "obrigacoes fiscais": "obrigacoes tributarias",
  "reserva de lucro": "reservas de lucros",
  "reserva de lucros": "reservas de lucros",
  // DRE (linhas de entrada e as calculadas, que só servem para não serem confundidas com as de entrada).
  "receita operacional bruta": "receita bruta",
  "receita bruta de vendas": "receita bruta",
  "receita bruta de vendas e servicos": "receita bruta",
  "faturamento bruto": "receita bruta",
  deducoes: "deducoes da receita",
  "deducoes da receita bruta": "deducoes da receita",
  "deducoes de vendas": "deducoes da receita",
  "impostos sobre vendas": "deducoes da receita",
  "receita operacional liquida": "receita liquida",
  "receita liquida de vendas": "receita liquida",
  cmv: "custo das mercadorias vendidas",
  cpv: "custo das mercadorias vendidas",
  "custo dos produtos vendidos": "custo das mercadorias vendidas",
  "custo das vendas": "custo das mercadorias vendidas",
  "custo dos servicos prestados": "custo das mercadorias vendidas",
  "custo serv produtos vendidos": "custo das mercadorias vendidas",
  "custo das mercadorias e servicos vendidos": "custo das mercadorias vendidas",
  "despesas operacionais liquidas": "despesas operacionais",
  "resultado financeiro liquido": "resultado financeiro",
  "receitas despesas financeiras": "resultado financeiro",
  "despesas receitas financeiras": "resultado financeiro",
  "imposto de renda e contribuicao social": "ir csll",
  "provisao para ir e csll": "ir csll",
  "provisao para imposto de renda e contribuicao social": "ir csll",
  "ir e csll": "ir csll",
  "lucro prejuizo liquido do exercicio": "lucro liquido do exercicio",
  "lucro prejuizo liq do exerc": "lucro liquido do exercicio",
  "lucro liquido": "lucro liquido do exercicio",
  "compras de mercadorias": "compras",
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function canonicalize(s: string): string {
  const normalized = normalize(s)
  return SYNONYMS[normalized] ?? normalized
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) dp[i][0] = i
  for (let j = 0; j < cols; j++) dp[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[rows - 1][cols - 1]
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshtein(a, b) / maxLen
}

export interface AccountMatch {
  account: Account | null
  score: number
}

// score: 0-100. >=96 nome idêntico (ou sinônimo conhecido), ~85 um contém o outro,
// abaixo disso é similaridade por distância de edição.
export function matchAccountName(label: string, leaves: Account[]): AccountMatch {
  const target = canonicalize(label)
  if (!target) return { account: null, score: 0 }

  let best: AccountMatch = { account: null, score: 0 }
  for (const account of leaves) {
    const candidate = canonicalize(account.name)
    const shorter = Math.min(candidate.length, target.length)
    const longer = Math.max(candidate.length, target.length)
    // Só conta "um contém o outro" como casamento forte se os dois têm tamanho parecido —
    // senão "Fornecedores" bateria com "Adiantamento a Fornecedores de Terceiros", que é
    // uma conta diferente.
    const isContainment = (candidate.includes(target) || target.includes(candidate)) && shorter / longer >= 0.6

    let score: number
    if (candidate === target) score = 96
    else if (isContainment) score = 85
    else score = Math.round(similarity(candidate, target) * 100)

    if (score > best.score) best = { account, score }
  }
  return best
}
