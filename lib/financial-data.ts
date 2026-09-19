// Modelo de dados e motor de cálculo da Central de Balanços.
// Valores em milhares de BRL (unidade base). A escala é aplicada só na exibição.
// Este arquivo é puro (sem estado React) — o estado editável vive em lib/store.tsx.

export interface Account {
  code: string
  name: string
  // Contas analíticas (folha) recebem valores por exercício. Ausência de valor
  // para um exercício = "não preenchido" (distinto de zero), usado para sinalizar
  // dados insuficientes (RN04).
  values?: Record<string, number>
  children?: Account[]
}

export const COMPANY = {
  name: "Farmácia Bem-Estar Ltda",
  cnpj: "12.345.678/0001-90",
}

function v(a: number, b: number, c: number, ids: string[]): Record<string, number> {
  return { [ids[0]]: a, [ids[1]]: b, [ids[2]]: c }
}

export const SEED_EXERCICIOS = ["4T2024", "1T2025", "1T2026"]

// Plano de Contas — padrão contábil brasileiro (dados de exemplo)
export function createSeedAccounts(): Account[] {
  const ids = SEED_EXERCICIOS
  return [
    {
      code: "1",
      name: "Ativo",
      children: [
        {
          code: "1.1",
          name: "Ativo Circulante",
          children: [
            { code: "1.1.1", name: "Disponibilidades", values: v(850, 920, 1050, ids) },
            { code: "1.1.2", name: "Aplicações Financeiras", values: v(1200, 1350, 1500, ids) },
            { code: "1.1.3", name: "Contas a Receber de Clientes", values: v(3200, 3450, 3800, ids) },
            { code: "1.1.4", name: "Estoques", values: v(2800, 2950, 3100, ids) },
            { code: "1.1.5", name: "Outros Créditos", values: v(450, 480, 520, ids) },
          ],
        },
        {
          code: "1.2",
          name: "Ativo Realizável a Longo Prazo",
          children: [
            { code: "1.2.1", name: "Aplicações Financeiras LP", values: v(600, 650, 700, ids) },
            { code: "1.2.2", name: "Depósitos Judiciais", values: v(300, 320, 350, ids) },
          ],
        },
        {
          code: "1.3",
          name: "Ativo Permanente",
          children: [
            { code: "1.3.1", name: "Imobilizado", values: v(4200, 4100, 4400, ids) },
            { code: "1.3.2", name: "Intangível", values: v(800, 850, 900, ids) },
          ],
        },
      ],
    },
    {
      code: "2",
      name: "Passivo",
      children: [
        {
          code: "2.1",
          name: "Passivo Circulante",
          children: [
            { code: "2.1.1", name: "Fornecedores", values: v(3100, 3300, 3500, ids) },
            { code: "2.1.2", name: "Empréstimos e Financiamentos", values: v(1800, 1900, 2000, ids) },
            { code: "2.1.3", name: "Obrigações Tributárias", values: v(700, 750, 820, ids) },
          ],
        },
        {
          code: "2.2",
          name: "Exigível a Longo Prazo",
          children: [{ code: "2.2.1", name: "Empréstimos LP", values: v(2400, 2500, 2600, ids) }],
        },
        {
          code: "2.3",
          name: "Patrimônio Líquido",
          children: [
            { code: "2.3.1", name: "Capital Social", values: v(5000, 5000, 5000, ids) },
            { code: "2.3.2", name: "Reservas de Lucros", values: v(1400, 1620, 2400, ids) },
          ],
        },
      ],
    },
  ]
}

// ---- DRE — Demonstração do Resultado do Exercício ----
// Linhas de entrada (o analista tabula) + linhas calculadas (totalizadores automáticos).

export type DreLineKind = "input" | "computed"

export interface DreLineDef {
  id: string
  name: string
  kind: DreLineKind
  deduction?: boolean
  isTotal?: boolean
}

export const DRE_LINES: DreLineDef[] = [
  { id: "receita-bruta", name: "Receita Bruta", kind: "input" },
  { id: "deducoes", name: "(-) Deduções da Receita", kind: "input", deduction: true },
  { id: "receita-liquida", name: "Receita Líquida", kind: "computed" },
  { id: "cmv", name: "(-) Custo das Mercadorias Vendidas", kind: "input", deduction: true },
  { id: "lucro-bruto", name: "Lucro Bruto", kind: "computed" },
  { id: "despesas-operacionais", name: "(-) Despesas Operacionais", kind: "input", deduction: true },
  { id: "ebit", name: "Resultado Operacional (EBIT)", kind: "computed" },
  { id: "resultado-financeiro", name: "(+/-) Resultado Financeiro", kind: "input" },
  { id: "resultado-antes-ir", name: "Resultado Antes do IR/CSLL", kind: "computed" },
  { id: "ir-csll", name: "(-) IR/CSLL", kind: "input", deduction: true },
  { id: "lucro-liquido", name: "Lucro Líquido do Exercício", kind: "computed", isTotal: true },
]

// Linha complementar (não faz parte do resultado) usada só para o índice PMPC.
export const DRE_MEMO_LINE = { id: "compras", name: "Compras (informativo — usado no PMPC)" }

export type DreValues = Partial<Record<string, number>>

function add2(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined) return undefined
  return a + b
}

// Recalcula os totalizadores da DRE a partir das linhas de entrada. Propaga
// "indefinido" quando falta algum insumo — RN04 (dados insuficientes).
export function computeDre(inputs: DreValues): Record<string, number | undefined> {
  const receitaBruta = inputs["receita-bruta"]
  const deducoes = inputs["deducoes"]
  const receitaLiquida = add2(receitaBruta, deducoes)
  const cmv = inputs["cmv"]
  const lucroBruto = add2(receitaLiquida, cmv)
  const despesasOperacionais = inputs["despesas-operacionais"]
  const ebit = add2(lucroBruto, despesasOperacionais)
  const resultadoFinanceiro = inputs["resultado-financeiro"]
  const resultadoAntesIr = add2(ebit, resultadoFinanceiro)
  const irCsll = inputs["ir-csll"]
  const lucroLiquido = add2(resultadoAntesIr, irCsll)

  return {
    "receita-bruta": receitaBruta,
    deducoes,
    "receita-liquida": receitaLiquida,
    cmv,
    "lucro-bruto": lucroBruto,
    "despesas-operacionais": despesasOperacionais,
    ebit,
    "resultado-financeiro": resultadoFinanceiro,
    "resultado-antes-ir": resultadoAntesIr,
    "ir-csll": irCsll,
    "lucro-liquido": lucroLiquido,
    compras: inputs.compras,
  }
}

// Retorna os inputs de DRE indexados por exercício (dreByExercicio[exercicioId][lineId]),
// que é a mesma chave usada pelo store (lib/store.tsx) e por computeDre().
export function createSeedDre(): Record<string, DreValues> {
  const ids = SEED_EXERCICIOS
  const byLine: Record<string, [number, number, number]> = {
    "receita-bruta": [22000, 5800, 6300],
    deducoes: [-4000, -1000, -1100],
    cmv: [-12600, -3360, -3640],
    "despesas-operacionais": [-3600, -960, -1000],
    "resultado-financeiro": [-400, -110, -120],
    "ir-csll": [-420, -111, -132],
    compras: [12800, 3400, 3700],
  }
  const out: Record<string, DreValues> = {}
  ids.forEach((exercicioId, i) => {
    const values: DreValues = {}
    for (const [lineId, series] of Object.entries(byLine)) values[lineId] = series[i]
    out[exercicioId] = values
  })
  return out
}

// DFC — Demonstração dos Fluxos de Caixa. Fora do escopo funcional da RFC
// (ver §2.6 "Fora do Escopo": não cobre DFC nesta versão) — mantida somente
// como visualização estática de exemplo, não editável na Tabulação.
export interface StaticLine {
  name: string
  values: Record<string, number>
  kind: "line" | "subtotal" | "total"
}

// Só a apresentação (subtotal/total em destaque) mora no código, como DRE_LINES; os valores
// vêm do banco. Chave = descrição da linha, que é o que /api/dfc devolve.
export const DFC_LINE_KINDS: Record<string, StaticLine["kind"]> = {
  "Fluxo de Caixa Operacional": "subtotal",
  "Fluxo de Caixa de Investimentos": "subtotal",
  "Fluxo de Caixa de Financiamentos": "subtotal",
  "Variação Líquida de Caixa": "total",
  "Caixa no Início do Período": "line",
  "Caixa no Fim do Período": "total",
}

export function createSeedDfc(): StaticLine[] {
  const ids = SEED_EXERCICIOS
  const line = (a: number, b: number, c: number): Record<string, number> => ({ [ids[0]]: a, [ids[1]]: b, [ids[2]]: c })
  const series: Record<string, Record<string, number>> = {
    "Fluxo de Caixa Operacional": line(1500, 420, 500),
    "Fluxo de Caixa de Investimentos": line(-800, -300, -400),
    "Fluxo de Caixa de Financiamentos": line(-500, -50, 30),
    "Variação Líquida de Caixa": line(200, 70, 130),
    "Caixa no Início do Período": line(650, 850, 920),
    "Caixa no Fim do Período": line(850, 920, 1050),
  }
  return Object.entries(DFC_LINE_KINDS).map(([name, kind]) => ({ name, values: series[name], kind }))
}

// ---- Cálculos sobre o Plano de Contas ----

// Soma um nó do plano de contas para um exercício. Retorna undefined
// (dados insuficientes) se o nó ou algum descendente não tiver valor lançado.
export function sumAccount(account: Account, period: string): number | undefined {
  if (account.values) return account.values[period]
  if (account.children) {
    let total = 0
    for (const child of account.children) {
      const val = sumAccount(child, period)
      if (val === undefined) return undefined
      total += val
    }
    return total
  }
  return undefined
}

export function findAccountByName(accounts: Account[], name: string): Account | undefined {
  const stack = [...accounts]
  while (stack.length) {
    const node = stack.pop()!
    if (node.name === name) return node
    if (node.children) stack.push(...node.children)
  }
  return undefined
}

export function accountTotalByName(accounts: Account[], name: string, period: string): number | undefined {
  const account = findAccountByName(accounts, name)
  return account ? sumAccount(account, period) : undefined
}

export function findAccountByCode(accounts: Account[], code: string): Account | undefined {
  const stack = [...accounts]
  while (stack.length) {
    const node = stack.pop()!
    if (node.code === code) return node
    if (node.children) stack.push(...node.children)
  }
  return undefined
}

export function collectLeaves(accounts: Account[], out: Account[] = []): Account[] {
  for (const account of accounts) {
    if (account.values) out.push(account)
    if (account.children) collectLeaves(account.children, out)
  }
  return out
}

export function flattenAccounts(
  accounts: Account[],
  depth = 0,
  out: { account: Account; depth: number }[] = [],
): { account: Account; depth: number }[] {
  for (const account of accounts) {
    out.push({ account, depth })
    if (account.children) flattenAccounts(account.children, depth + 1, out)
  }
  return out
}

// ---- Motor de Índices Financeiros (RN01 / Apêndice C) ----

export type IndicatorGroup = "Liquidez" | "Endividamento" | "Rentabilidade" | "Atividade"
export type IndicatorUnit = "ratio" | "percent" | "dias"

export interface IndicatorContext {
  get: (accountName: string) => number | undefined
  dre: Record<string, number | undefined>
}

export interface Indicator {
  id: string
  name: string
  formula: string
  // Explicação em uma frase, sem jargão contábil — para quem não é da área financeira.
  description: string
  group: IndicatorGroup
  unit: IndicatorUnit
  higherIsBetter: boolean
  thresholdGood: number
  thresholdMedium: number
  compute: (ctx: IndicatorContext) => number | undefined
}

function div(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined || b === 0) return undefined
  return a / b
}
function sub(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined) return undefined
  return a - b
}
function mulPercent(x?: number): number | undefined {
  return x === undefined ? undefined : x * 100
}

export const INDICATORS: Indicator[] = [
  {
    id: "liquidez-corrente",
    name: "Liquidez Corrente",
    formula: "[Ativo Circulante] / [Passivo Circulante]",
    description: "Mostra se a empresa tem bens e direitos suficientes no curto prazo para pagar o que deve no curto prazo.",
    group: "Liquidez",
    unit: "ratio",
    higherIsBetter: true,
    thresholdGood: 1.5,
    thresholdMedium: 1.0,
    compute: ({ get }) => div(get("Ativo Circulante"), get("Passivo Circulante")),
  },
  {
    id: "liquidez-seca",
    name: "Liquidez Seca",
    formula: "([Ativo Circulante] − [Estoques]) / [Passivo Circulante]",
    description: "A mesma ideia da liquidez corrente, mas sem contar com a venda dos estoques — um teste mais rígido.",
    group: "Liquidez",
    unit: "ratio",
    higherIsBetter: true,
    thresholdGood: 1.0,
    thresholdMedium: 0.7,
    compute: ({ get }) => div(sub(get("Ativo Circulante"), get("Estoques")), get("Passivo Circulante")),
  },
  {
    id: "liquidez-geral",
    name: "Liquidez Geral",
    formula: "([Ativo Circulante] + [Ativo Realizável a Longo Prazo]) / ([Passivo Circulante] + [Exigível a Longo Prazo])",
    description: "Compara tudo que a empresa vai receber (curto e longo prazo) com tudo que ela deve (curto e longo prazo).",
    group: "Liquidez",
    unit: "ratio",
    higherIsBetter: true,
    thresholdGood: 1.0,
    thresholdMedium: 0.7,
    compute: ({ get }) => {
      const num = add2(get("Ativo Circulante"), get("Ativo Realizável a Longo Prazo"))
      const den = add2(get("Passivo Circulante"), get("Exigível a Longo Prazo"))
      return div(num, den)
    },
  },
  {
    id: "liquidez-imediata",
    name: "Liquidez Imediata",
    formula: "[Disponibilidades] / [Passivo Circulante]",
    description:
      "Quanto a empresa tem em caixa e aplicações prontas para cobrir as dívidas de curto prazo, sem esperar receber nada.",
    group: "Liquidez",
    unit: "ratio",
    higherIsBetter: true,
    thresholdGood: 0.3,
    thresholdMedium: 0.15,
    compute: ({ get }) => div(get("Disponibilidades"), get("Passivo Circulante")),
  },
  {
    id: "endividamento-geral",
    name: "Endividamento Geral",
    formula: "[Passivo Total] / [Ativo Total]",
    description: "Qual fatia de tudo que a empresa possui foi financiada com dívidas, em vez de capital próprio dos sócios.",
    group: "Endividamento",
    unit: "percent",
    higherIsBetter: false,
    thresholdGood: 50,
    thresholdMedium: 70,
    compute: ({ get }) => mulPercent(div(add2(get("Passivo Circulante"), get("Exigível a Longo Prazo")), get("Ativo"))),
  },
  {
    id: "composicao-endividamento",
    name: "Composição do Endividamento",
    formula: "[Passivo Circulante] / [Passivo Total]",
    description: "Das dívidas da empresa, quanto precisa ser pago logo (curto prazo) em vez de mais para frente.",
    group: "Endividamento",
    unit: "percent",
    higherIsBetter: false,
    thresholdGood: 60,
    thresholdMedium: 80,
    compute: ({ get }) =>
      mulPercent(div(get("Passivo Circulante"), add2(get("Passivo Circulante"), get("Exigível a Longo Prazo")))),
  },
  {
    id: "imobilizacao-pl",
    name: "Imobilização do PL",
    formula: "[Ativo Permanente] / [Patrimônio Líquido]",
    description:
      "Quanto do capital próprio da empresa está preso em bens fixos (imóveis, máquinas), sobrando menos para o giro do negócio.",
    group: "Endividamento",
    unit: "percent",
    higherIsBetter: false,
    thresholdGood: 70,
    thresholdMedium: 100,
    compute: ({ get }) => mulPercent(div(get("Ativo Permanente"), get("Patrimônio Líquido"))),
  },
  {
    id: "margem-bruta",
    name: "Margem Bruta",
    formula: "[Lucro Bruto] / [Receita Líquida]",
    description: "De cada R$ 100 vendidos, quanto sobra depois de pagar o custo direto do produto ou serviço.",
    group: "Rentabilidade",
    unit: "percent",
    higherIsBetter: true,
    thresholdGood: 30,
    thresholdMedium: 15,
    compute: ({ dre }) => mulPercent(div(dre["lucro-bruto"], dre["receita-liquida"])),
  },
  {
    id: "margem-liquida",
    name: "Margem Líquida",
    formula: "[Lucro Líquido] / [Receita Líquida]",
    description: "De cada R$ 100 vendidos, quanto vira lucro depois de todas as despesas e impostos.",
    group: "Rentabilidade",
    unit: "percent",
    higherIsBetter: true,
    thresholdGood: 5,
    thresholdMedium: 2,
    compute: ({ dre }) => mulPercent(div(dre["lucro-liquido"], dre["receita-liquida"])),
  },
  {
    id: "roe",
    name: "ROE",
    formula: "[Lucro Líquido] / [Patrimônio Líquido]",
    description: "Quanto de lucro a empresa gerou para cada R$ 100 investidos pelos próprios sócios.",
    group: "Rentabilidade",
    unit: "percent",
    higherIsBetter: true,
    thresholdGood: 15,
    thresholdMedium: 8,
    compute: ({ get, dre }) => mulPercent(div(dre["lucro-liquido"], get("Patrimônio Líquido"))),
  },
  {
    id: "roa",
    name: "ROA",
    formula: "[Lucro Líquido] / [Ativo Total]",
    description: "Quanto de lucro a empresa gerou para cada R$ 100 que ela possui em bens e direitos, dívida incluída.",
    group: "Rentabilidade",
    unit: "percent",
    higherIsBetter: true,
    thresholdGood: 8,
    thresholdMedium: 3,
    compute: ({ get, dre }) => mulPercent(div(dre["lucro-liquido"], get("Ativo"))),
  },
  {
    id: "giro-ativo",
    name: "Giro do Ativo",
    formula: "[Receita Líquida] / [Ativo Total]",
    description: "Quantas vezes, no ano, a empresa transforma em vendas tudo que ela possui.",
    group: "Atividade",
    unit: "ratio",
    higherIsBetter: true,
    thresholdGood: 1,
    thresholdMedium: 0.5,
    compute: ({ get, dre }) => div(dre["receita-liquida"], get("Ativo")),
  },
  {
    id: "pmre",
    name: "PMRE (Prazo Médio de Renovação de Estoques)",
    formula: "([Estoques] / |[CMV]|) × 360",
    description: "Em média, quantos dias o estoque fica parado até ser vendido.",
    group: "Atividade",
    unit: "dias",
    higherIsBetter: false,
    thresholdGood: 60,
    thresholdMedium: 90,
    compute: ({ get, dre }) => {
      const cmv = dre.cmv === undefined ? undefined : Math.abs(dre.cmv)
      const r = div(get("Estoques"), cmv)
      return r === undefined ? undefined : r * 360
    },
  },
  {
    id: "pmrv",
    name: "PMRV (Prazo Médio de Recebimento de Vendas)",
    formula: "([Contas a Receber] / [Receita Bruta]) × 360",
    description: "Em média, quantos dias a empresa demora para receber dos clientes depois de vender.",
    group: "Atividade",
    unit: "dias",
    higherIsBetter: false,
    thresholdGood: 45,
    thresholdMedium: 60,
    compute: ({ get, dre }) => {
      const r = div(get("Contas a Receber de Clientes"), dre["receita-bruta"])
      return r === undefined ? undefined : r * 360
    },
  },
  {
    id: "pmpc",
    name: "PMPC (Prazo Médio de Pagamento de Compras)",
    formula: "([Fornecedores] / [Compras]) × 360",
    description: "Em média, quantos dias a empresa demora para pagar seus fornecedores.",
    group: "Atividade",
    unit: "dias",
    higherIsBetter: true,
    thresholdGood: 45,
    thresholdMedium: 30,
    compute: ({ get, dre }) => {
      const r = div(get("Fornecedores"), dre.compras)
      return r === undefined ? undefined : r * 360
    },
  },
]

export function makeIndicatorContext(accounts: Account[], dre: Record<string, number | undefined>, period: string): IndicatorContext {
  const cache = new Map<string, number | undefined>()
  return {
    get: (name: string) => {
      if (cache.has(name)) return cache.get(name)
      const value = accountTotalByName(accounts, name, period)
      cache.set(name, value)
      return value
    },
    dre,
  }
}

export type IndicatorStatus = "ok" | "atencao" | "risco" | "indisponivel"

export function indicatorStatus(indicator: Indicator, value: number | undefined): IndicatorStatus {
  if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "indisponivel"
  const { thresholdGood, thresholdMedium, higherIsBetter } = indicator
  if (higherIsBetter) {
    if (value >= thresholdGood) return "ok"
    if (value >= thresholdMedium) return "atencao"
    return "risco"
  }
  if (value <= thresholdGood) return "ok"
  if (value <= thresholdMedium) return "atencao"
  return "risco"
}

// ---- Formatação brasileira ----

export type Scale = "unidade" | "milhares" | "milhoes"

export const SCALE_LABEL: Record<Scale, string> = {
  unidade: "Unidade",
  milhares: "Milhares",
  milhoes: "Milhões",
}

// Os valores base já estão em milhares. Convertemos para a escala escolhida.
export function applyScale(valueInThousands: number, scale: Scale): number {
  switch (scale) {
    case "unidade":
      return valueInThousands * 1000
    case "milhares":
      return valueInThousands
    case "milhoes":
      return valueInThousands / 1000
  }
}

export function formatBRL(value: number, decimals = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatScaled(value: number | undefined, scale: Scale): string {
  if (value === undefined) return "—"
  const scaled = applyScale(value, scale)
  const decimals = scale === "milhoes" ? 2 : 0
  return formatBRL(scaled, decimals)
}

export function formatRatio(value: number): string {
  return formatBRL(value, 2)
}

export function formatPercent(value: number): string {
  return `${formatBRL(value, 1)}%`
}

export const DADOS_INSUFICIENTES = "Dados insuficientes"

export function formatIndicatorValue(indicator: Indicator, value: number | undefined): string {
  if (value === undefined) return DADOS_INSUFICIENTES
  switch (indicator.unit) {
    case "percent":
      return formatPercent(value)
    case "dias":
      return `${Math.round(value)} dias`
    default:
      return formatRatio(value)
  }
}

export function deltaPercent(current: number | undefined, previous: number | undefined): number | undefined {
  if (current === undefined || previous === undefined || previous === 0) return undefined
  return ((current - previous) / Math.abs(previous)) * 100
}

// ---- Opinião de Venda (parecer de crédito) — funcionalidade extra, fora da RFC ----

export type OpinionRating = "favoravel" | "ressalvas" | "desfavoravel"
export type CriterionStatus = "ok" | "atencao" | "risco"

export interface OpinionCriterion {
  label: string
  detail: string
  value: string
  status: CriterionStatus
  weight: number
  score: number
}

export interface SalesOpinion {
  requestedValue: number
  suggestedLimit: number
  coverage: number
  score: number
  rating: OpinionRating
  ratingLabel: string
  headline: string
  criteria: OpinionCriterion[]
  narrative: string[]
}

export const RATING_LABEL: Record<OpinionRating, string> = {
  favoravel: "Favorável",
  ressalvas: "Favorável com ressalvas",
  desfavoravel: "Desfavorável",
}

function scoreBand(value: number, good: number, medium: number, higherIsBetter = true): CriterionStatus {
  if (higherIsBetter) {
    if (value >= good) return "ok"
    if (value >= medium) return "atencao"
    return "risco"
  }
  if (value <= good) return "ok"
  if (value <= medium) return "atencao"
  return "risco"
}

const STATUS_SCORE: Record<CriterionStatus, number> = { ok: 100, atencao: 60, risco: 20 }

export function suggestedCreditLimit(
  accounts: Account[],
  dre: Record<string, number | undefined>,
  dfc: StaticLine[],
  period: string,
): number {
  const receitaLiquida = dre["receita-liquida"] ?? 0
  const annualizedRevenue = receitaLiquida * 4
  const pl = accountTotalByName(accounts, "Patrimônio Líquido", period) ?? 0
  const operatingCash = (dfc.find((l) => l.name === "Fluxo de Caixa Operacional")?.values[period] ?? 0) * 4
  const candidates = [annualizedRevenue * 0.25, pl * 1.2, operatingCash * 3]
  const limitInThousands = Math.max(0, Math.min(...candidates))
  return Math.round(limitInThousands * 1000)
}

export function buildSalesOpinion(
  accounts: Account[],
  dreByExercicio: Record<string, DreValues>,
  dfc: StaticLine[],
  period: string,
  previousPeriod: string | undefined,
  requestedValue: number,
): SalesOpinion {
  const dre = computeDre(dreByExercicio[period] ?? {})
  const ctx = makeIndicatorContext(accounts, dre, period)

  const liquidez = INDICATORS.find((i) => i.id === "liquidez-corrente")!.compute(ctx) ?? 0
  const endividamento = INDICATORS.find((i) => i.id === "endividamento-geral")!.compute(ctx) ?? 0
  const margem = INDICATORS.find((i) => i.id === "margem-liquida")!.compute(ctx) ?? 0

  const lucroAtual = dre["lucro-liquido"] ?? 0
  const drePrev = previousPeriod ? computeDre(dreByExercicio[previousPeriod] ?? {}) : undefined
  const lucroAnterior = drePrev?.["lucro-liquido"] ?? 0
  const tendenciaLucro = deltaPercent(lucroAtual, lucroAnterior) ?? 0

  const limit = suggestedCreditLimit(accounts, dre, dfc, period)
  const coverage = requestedValue > 0 ? limit / requestedValue : 0

  const criteria: OpinionCriterion[] = [
    {
      label: "Liquidez Corrente",
      detail: "Se a empresa consegue pagar as contas de curto prazo com o que tem disponível",
      value: formatRatio(liquidez),
      status: scoreBand(liquidez, 1.5, 1.0, true),
      weight: 0.2,
      score: 0,
    },
    {
      label: "Endividamento",
      detail: "Quanto do que a empresa tem foi financiado com dívidas, em vez de capital próprio",
      value: formatPercent(endividamento),
      status: scoreBand(endividamento, 50, 70, false),
      weight: 0.2,
      score: 0,
    },
    {
      label: "Margem Líquida",
      detail: "De cada R$ 100 vendidos, quanto vira lucro",
      value: formatPercent(margem),
      status: scoreBand(margem, 5, 2, true),
      weight: 0.2,
      score: 0,
    },
    {
      label: "Tendência do Lucro",
      detail: previousPeriod ? `Lucro comparado ao período anterior (${previousPeriod})` : "Sem período anterior para comparar",
      value: `${tendenciaLucro >= 0 ? "+" : ""}${formatBRL(tendenciaLucro, 1)}%`,
      status: scoreBand(tendenciaLucro, 5, -5, true),
      weight: 0.15,
      score: 0,
    },
    {
      label: "Cobertura da Solicitação",
      detail: "Quanto do valor pedido a empresa consegue cobrir com segurança",
      value: requestedValue > 0 ? `${formatBRL(coverage, 2)}×` : "—",
      status: requestedValue > 0 ? scoreBand(coverage, 1, 0.75, true) : "atencao",
      weight: 0.25,
      score: 0,
    },
  ]

  for (const c of criteria) c.score = STATUS_SCORE[c.status]
  const score = Math.round(criteria.reduce((acc, c) => acc + c.score * c.weight, 0))

  let rating: OpinionRating
  if (score >= 70) rating = "favoravel"
  else if (score >= 45) rating = "ressalvas"
  else rating = "desfavoravel"

  const headline =
    rating === "favoravel"
      ? "Operação recomendada dentro do limite sugerido."
      : rating === "ressalvas"
        ? "Operação viável mediante condições e garantias adicionais."
        : "Operação não recomendada no valor solicitado."

  // Frases curtas, em linguagem simples primeiro — o número técnico vem entre
  // parênteses como apoio, não como a informação principal (RN — parecer legível
  // por quem não é da área financeira).
  const liquidezCriterion = criteria.find((c) => c.label === "Liquidez Corrente")!
  const endividamentoCriterion = criteria.find((c) => c.label === "Endividamento")!

  const narrative: string[] = []

  narrative.push(
    liquidezCriterion.status === "ok"
      ? `A empresa consegue pagar suas contas de curto prazo com folga (liquidez corrente de ${formatRatio(liquidez)} — acima de 1 é positivo).`
      : liquidezCriterion.status === "atencao"
        ? `A empresa consegue pagar suas contas de curto prazo, mas com pouca margem (liquidez corrente de ${formatRatio(liquidez)}).`
        : `A empresa pode ter dificuldade para pagar suas contas de curto prazo (liquidez corrente de ${formatRatio(liquidez)} — abaixo de 1 é sinal de alerta).`,
  )

  narrative.push(
    endividamentoCriterion.status === "ok"
      ? `O nível de dívidas em relação a tudo que a empresa possui é saudável (${formatPercent(endividamento)} financiado por terceiros).`
      : endividamentoCriterion.status === "atencao"
        ? `O nível de dívidas em relação a tudo que a empresa possui pede atenção (${formatPercent(endividamento)} financiado por terceiros).`
        : `O nível de dívidas em relação a tudo que a empresa possui é elevado (${formatPercent(endividamento)} financiado por terceiros).`,
  )

  narrative.push(
    `De cada R$ 100 vendidos no período ${period}, sobram R$ ${formatBRL(margem, 2)} de lucro depois de todas as despesas e impostos.`,
  )

  narrative.push(
    previousPeriod
      ? tendenciaLucro >= 0
        ? `O lucro cresceu ${formatBRL(tendenciaLucro, 1)}% frente a ${previousPeriod}, o que reforça a capacidade de pagamento.`
        : `O lucro recuou ${formatBRL(Math.abs(tendenciaLucro), 1)}% frente a ${previousPeriod}, o que exige atenção.`
      : `Ainda não há período anterior tabulado para comparar a evolução do lucro.`,
  )

  if (requestedValue > 0) {
    narrative.push(
      coverage >= 1
        ? `O valor pedido (R$ ${formatBRL(requestedValue, 2)}) cabe dentro do que a empresa consegue sustentar com segurança (limite calculado: R$ ${formatBRL(limit, 2)}).`
        : `O valor pedido (R$ ${formatBRL(requestedValue, 2)}) é maior do que a empresa consegue sustentar com segurança (limite calculado: R$ ${formatBRL(limit, 2)}). Recomenda-se reduzir o valor ou pedir garantias adicionais.`,
    )
  } else {
    narrative.push(`Informe o valor pedido para saber se ele cabe dentro do que a empresa consegue sustentar com segurança.`)
  }

  return {
    requestedValue,
    suggestedLimit: limit,
    coverage,
    score,
    rating,
    ratingLabel: RATING_LABEL[rating],
    headline,
    criteria,
    narrative,
  }
}
