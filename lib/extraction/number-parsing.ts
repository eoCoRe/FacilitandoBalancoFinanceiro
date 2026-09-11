// Leitura de valores monetários em formato BR (ponto de milhar, vírgula decimal,
// parênteses para negativo) a partir de texto extraído de PDF, e separação entre o
// rótulo da conta e o valor numa mesma linha do documento.

// Exige separador de milhar a cada grupo de 3 dígitos (","1.1.1" de um código de conta
// não bate porque cada segmento tem 1 dígito, não 3) — evita confundir código de conta
// com valor. Números de 4+ dígitos sem separador (raro em demonstrativo formatado) não
// são reconhecidos; é uma limitação aceita em troca de não interpretar código como valor.
const NUMBER_TOKEN_RE = /\(?-?\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\)?/g

function parseNumberToken(raw: string): number {
  const negative = /\(.*\)/.test(raw) || raw.includes("-")
  const cleaned = raw.replace(/[()\-\s]/g, "").replace(/\./g, "").replace(",", ".")
  const value = Number(cleaned)
  return negative ? -Math.abs(value) : value
}

export interface LabelAndValue {
  label: string
  value: number
}

// O rótulo é o texto ANTES da primeira coluna numérica (depois de tirar um eventual
// código de conta no início, ex. "1.1.1"); o valor é a ÚLTIMA coluna numérica da linha —
// em demonstrativos com vários exercícios lado a lado, a mais à direita. Separar assim
// (primeira ↔ nome, última ↔ valor) evita ter que "limpar" números do meio do rótulo.
export function extractLabelAndValue(line: string): LabelAndValue | null {
  const withoutCode = line.replace(/^\s*\d+(?:\.\d+)*\s+/, "")

  const matches = [...withoutCode.matchAll(NUMBER_TOKEN_RE)].filter((m) => {
    const afterEnd = m.index + m[0].length
    return withoutCode[afterEnd] !== "%"
  })
  if (matches.length === 0) return null

  const value = parseNumberToken(matches[matches.length - 1][0])
  if (!Number.isFinite(value)) return null

  let label = withoutCode.slice(0, matches[0].index)
  label = label.replace(/[.\-·\s]{2,}$/, "").trim() // remove pontilhado que liga nome ao valor
  if (label.length < 3) return null

  return { label, value }
}
