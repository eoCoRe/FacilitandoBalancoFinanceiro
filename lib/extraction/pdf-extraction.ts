// Orquestra a extração real (sem LLM, sem API externa): texto do PDF → linha → rótulo +
// valor → casamento com o Plano de Contas. `extractRowsFromLines` é pura (testável com
// linhas sintéticas); `extractFromPdfFile` é a única parte que depende do pdfjs/navegador.

import { collectLeaves, type Account } from "../financial-data"
import { matchAccountName } from "./account-matcher"
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
  const leaves = collectLeaves(accounts)
  const rows: ExtractedRow[] = []
  const rowIndexByCode = new Map<string, number>()
  // Coluna do exercício mais recente, descoberta pelo cabeçalho da página (cada página repete o seu; uma página
  // sem cabeçalho de anos, como uma DRE com coluna de %, volta ao padrão: a última coluna).
  let page = -1
  let columnFromRight = 0

  lines.forEach((line, i) => {
    if (line.page !== page) {
      page = line.page
      columnFromRight = 0
    }
    const header = newestColumnFromRight(line.text)
    if (header !== null) {
      columnFromRight = header
      return
    }
    const parsed = extractLabelAndValue(line.text, columnFromRight)
    if (!parsed) return

    const { account, score } = matchAccountName(parsed.label, leaves)
    const code = account && score >= MATCH_THRESHOLD ? account.code : null
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

  return normalizeCreditSign(rows)
}

export interface PdfExtractionResult {
  supported: boolean
  rows: ExtractedRow[]
}

export async function extractFromPdfFile(file: File, accounts: Account[]): Promise<PdfExtractionResult> {
  const { hasText, lines } = await extractPdfText(file)
  if (!hasText) return { supported: false, rows: [] }
  return { supported: true, rows: extractRowsFromLines(lines, accounts) }
}
