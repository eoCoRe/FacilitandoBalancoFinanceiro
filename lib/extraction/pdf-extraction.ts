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
  value: number
  confidence: number
  page: number
}

// Score mínimo para atribuir automaticamente uma conta em vez de deixar "não
// reconhecida" (mapeamento manual) — melhor falhar visível do que arriscar um palpite.
const MATCH_THRESHOLD = 70

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
      value: parsed.value,
      confidence,
      page: line.page,
    }

    if (code) {
      const existingIndex = rowIndexByCode.get(code)
      if (existingIndex !== undefined) {
        if (rows[existingIndex].confidence < confidence) rows[existingIndex] = row
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
