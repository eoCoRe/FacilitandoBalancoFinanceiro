// Orquestra a extração real (sem LLM, sem API externa): texto do PDF → linha → rótulo +
// valor → casamento com o Plano de Contas. `extractRowsFromLines` é pura (testável com
// linhas sintéticas); `extractFromPdfFile` é a única parte que depende do pdfjs/navegador.

import { collectLeaves, DRE_LINES, DRE_MEMO_LINE, type Account } from "../financial-data"
import { matchAccountName, normalize } from "./account-matcher"
import { extractLabelAndValue, newestColumnFromRight } from "./number-parsing"
import { extractPdfText } from "./pdf-text"

export interface ExtractedRow {
  id: string
  code: string | null
  suggestedName: string
  // Texto exato lido no documento (antes do casamento com o Plano de Contas): é a origem do valor (RF06).
  sourceLabel: string
  value: number
  confidence: number
  page: number
}

// Score mínimo para atribuir automaticamente uma conta em vez de deixar "não
// reconhecida" (mapeamento manual) — melhor falhar visível do que arriscar um palpite.
const MATCH_THRESHOLD = 70

// ---- DRE ----
// As linhas de ENTRADA da DRE também são alvo da extração, com o código `dre:<id da linha>` (a tela/o store trocam
// pelo id da conta DRE no banco). As linhas CALCULADAS (Receita Líquida, Lucro Bruto...) entram só como "chamariz":
// são reconhecidas, para "RECEITA LIQUIDA" não ser confundida com "Receita Bruta", mas nunca recebem valor — o
// sistema as recalcula.
export const DRE_CODE_PREFIX = "dre:"
const DRE_CALC_PREFIX = "dre=calculada:"

export function dreLineIdFromCode(code: string): string | null {
  return code.startsWith(DRE_CODE_PREFIX) ? code.slice(DRE_CODE_PREFIX.length) : null
}

// Opções de linha da DRE para o mapeamento manual e para o casamento automático.
export function dreExtractionTargets(): Account[] {
  return [
    ...DRE_LINES.filter((l) => l.kind === "input").map((l) => ({ code: `${DRE_CODE_PREFIX}${l.id}`, name: l.name, values: {} })),
    { code: `${DRE_CODE_PREFIX}${DRE_MEMO_LINE.id}`, name: "Compras", values: {} },
  ]
}

const DRE_DECOYS: Account[] = DRE_LINES.filter((l) => l.kind === "computed").map((l) => ({
  code: `${DRE_CALC_PREFIX}${l.id}`,
  name: l.name,
  values: {},
}))

// Na DRE deste sistema as deduções (deduções, custo, despesas, IR) ficam NEGATIVAS e a receita/compras POSITIVAS; o
// PDF pode trazer qualquer das convenções ("81.550.439,82-", "(81.550.439,82)" ou sem sinal). O resultado financeiro
// fica com o sinal lido: pode ser dos dois lados.
const DRE_DEDUCTION_IDS = new Set(DRE_LINES.filter((l) => l.deduction).map((l) => l.id))
function normalizeDreSign(row: ExtractedRow): ExtractedRow {
  const lineId = row.code ? dreLineIdFromCode(row.code) : null
  if (lineId === null || lineId === "resultado-financeiro") return row
  const value = DRE_DEDUCTION_IDS.has(lineId) ? -Math.abs(row.value) : Math.abs(row.value)
  return { ...row, value }
}

// ---- Unidade ----
// O sistema guarda os valores em MILHARES de reais; a maioria dos balanços vem em reais. O documento que se declara em
// milhares ("Em milhares de reais", "R$ mil") é lido como tal; senão, assume reais (o analista pode trocar na tela).
export type DocumentUnit = "reais" | "milhares"
const THOUSANDS_RE = /em\s+milhares|milhares\s+de\s+reais|R\$\s*mil\b|\(\s*mil\s*\)/i

export function detectUnit(lines: { text: string }[]): DocumentUnit {
  return lines.some((l) => THOUSANDS_RE.test(l.text)) ? "milhares" : "reais"
}

// Valor do documento → valor do sistema (milhares de reais, 2 casas como no banco: Decimal(18, 2)).
export function toSystemUnit(value: number, unit: DocumentUnit): number {
  return unit === "reais" ? Math.round(value / 10) / 100 : value
}

// ---- Seções do Balanço ----
// "EMPRÉSTIMOS" no Passivo NÃO Circulante não é a conta de curto prazo, nem "APLICAÇÕES" no Realizável a Longo Prazo.
// O leitor acompanha os títulos de seção do documento e só casa contas cujo grupo no Plano de Contas é da mesma seção.
// Documento sem títulos reconhecíveis, ou conta cujo grupo não indica a seção: não restringe nada. As linhas da DRE
// ficam fora disso (uma DRE pode vir na mesma página, sem título que a separe).
type Section = "ativo-circulante" | "ativo-nao-circulante" | "passivo-circulante" | "passivo-nao-circulante" | "pl"

const SECTION_PATTERNS: [Section, RegExp][] = [
  ["ativo-circulante", /^ativo circulante\b/],
  ["ativo-nao-circulante", /^ativo nao circulante\b|realizavel a longo prazo|^ativo permanente\b|^permanente\b/],
  ["passivo-circulante", /^passivo circulante\b/],
  ["passivo-nao-circulante", /^passivo nao circulante\b|exigivel a longo prazo|^passivo exigivel a l/],
  ["pl", /^patrimonio liquido\b/],
]

function sectionOf(text: string): Section | null {
  const normalized = normalize(text)
  return SECTION_PATTERNS.find(([, re]) => re.test(normalized))?.[0] ?? null
}

// Seção de cada conta analítica = a do grupo mais próximo cujo nome indica uma seção.
function leafSections(accounts: Account[], inherited: Section | null = null, out = new Map<string, Section>()) {
  for (const account of accounts) {
    const section = (account.children ? sectionOf(account.name) : null) ?? inherited
    if (!account.children && section) out.set(account.code, section)
    if (account.children) leafSections(account.children, section, out)
  }
  return out
}

// A linha repetida vira "sem conta": mantém o texto, a página e a confiança lidos, mas não disputa a conta.
function semConta(row: ExtractedRow): ExtractedRow {
  return { ...row, code: null, suggestedName: row.sourceLabel }
}

// Balancete no padrão débito/crédito mostra o passivo e o PL com sinal de crédito ("28.999.279,50-"). O Plano de
// Contas guarda o passivo POSITIVO (é assim que os índices o usam), então, se a maioria das contas de passivo lidas
// (código "2...", o padrão brasileiro) veio negativa, o documento usa essa convenção e o sinal delas é invertido —
// inclusive o de um PL com prejuízo, que no balancete aparece positivo. O texto lido fica intacto em `sourceLabel`.
function normalizeCreditSign(rows: ExtractedRow[]): ExtractedRow[] {
  const passivo = rows.filter((r) => r.code?.startsWith("2") && r.value !== 0)
  const negativos = passivo.filter((r) => r.value < 0).length
  if (negativos * 2 <= passivo.length) return rows
  return rows.map((r) => (r.code?.startsWith("2") && r.value !== 0 ? { ...r, value: -r.value } : r))
}

export function extractRowsFromLines(lines: { text: string; page: number }[], accounts: Account[]): ExtractedRow[] {
  const leaves = [...collectLeaves(accounts), ...dreExtractionTargets(), ...DRE_DECOYS]
  const rows: ExtractedRow[] = []
  const rowIndexByCode = new Map<string, number>()
  // Coluna do exercício mais recente, descoberta pelo cabeçalho da página (cada página repete o seu; uma página
  // sem cabeçalho de anos, como uma DRE com coluna de %, volta ao padrão: a última coluna).
  let page = -1
  let columnFromRight = 0
  const sectionByCode = leafSections(accounts)
  let section: Section | null = null

  lines.forEach((line, i) => {
    if (line.page !== page) {
      page = line.page
      columnFromRight = 0
      section = null
    }
    const header = newestColumnFromRight(line.text)
    if (header !== null) {
      columnFromRight = header
      return
    }
    // Título de seção (com ou sem o total ao lado): as linhas seguintes pertencem a ela.
    const lineSection = sectionOf(line.text)
    if (lineSection) section = lineSection
    const parsed = extractLabelAndValue(line.text, columnFromRight)
    if (!parsed) return

    const candidates = section ? leaves.filter((l) => (sectionByCode.get(l.code) ?? section) === section) : leaves
    const { account, score } = matchAccountName(parsed.label, candidates)
    const matched = account && score >= MATCH_THRESHOLD ? account.code : null
    const code = matched?.startsWith(DRE_CALC_PREFIX) ? null : matched
    const confidence = Math.max(40, Math.min(99, score))
    const row: ExtractedRow = {
      id: `pdf-${line.page}-${i}`,
      code,
      suggestedName: account && code ? account.name : parsed.label,
      sourceLabel: parsed.label,
      value: parsed.value,
      confidence,
      page: line.page,
    }

    if (code) {
      const existingIndex = rowIndexByCode.get(code)
      if (existingIndex !== undefined) {
        // A mesma conta apareceu de novo (ex.: no balanço e numa nota explicativa). Uma conta recebe UM valor, e fica
        // a leitura de maior confiança; a outra NÃO é jogada fora: continua na lista como linha SEM conta (só vai
        // para o histórico, sem lançar valor), para a trilha do RF06 guardar tudo o que foi lido e o analista poder
        // conferir a divergência.
        const anterior = rows[existingIndex]
        if (anterior.confidence < confidence) {
          rows[existingIndex] = row
          rows.push(semConta(anterior))
        } else {
          rows.push(semConta(row))
        }
        return
      }
      rowIndexByCode.set(code, rows.length)
    }
    rows.push(row)
  })

  return normalizeCreditSign(rows).map(normalizeDreSign)
}

export interface PdfExtractionResult {
  supported: boolean
  rows: ExtractedRow[]
  unit: DocumentUnit
}

export async function extractFromPdfFile(file: File, accounts: Account[]): Promise<PdfExtractionResult> {
  const { hasText, lines } = await extractPdfText(file)
  if (!hasText) return { supported: false, rows: [], unit: "reais" }
  return { supported: true, rows: extractRowsFromLines(lines, accounts), unit: detectUnit(lines) }
}
