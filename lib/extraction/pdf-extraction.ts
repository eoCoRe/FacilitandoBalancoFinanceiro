// Orquestra a extração real (sem LLM, sem API externa): texto do PDF → linha → rótulo +
// valor → casamento com o Plano de Contas. `extractRowsFromLines` é pura (testável com
// linhas sintéticas); `extractFromPdfFile` é a única parte que depende do pdfjs/navegador.

import { collectLeaves, type Account } from "../financial-data"
import { matchAccountName } from "./account-matcher"
import { extractLabelAndValue } from "./number-parsing"
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

export function extractRowsFromLines(lines: { text: string; page: number }[], accounts: Account[]): ExtractedRow[] {
  const leaves = collectLeaves(accounts)
  const rows: ExtractedRow[] = []
  const rowIndexByCode = new Map<string, number>()

  lines.forEach((line, i) => {
    const parsed = extractLabelAndValue(line.text)
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

  return rows
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
