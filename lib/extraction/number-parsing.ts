// Leitura de valores monetários em formato BR (ponto de milhar, vírgula decimal,
// parênteses para negativo) a partir de texto extraído de PDF, e separação entre o
// rótulo da conta e o valor numa mesma linha do documento.

// Exige separador de milhar a cada grupo de 3 dígitos (","1.1.1" de um código de conta
// não bate porque cada segmento tem 1 dígito, não 3) — evita confundir código de conta
// com valor. Números de 4+ dígitos sem separador (raro em demonstrativo formatado) não
// são reconhecidos; é uma limitação aceita em troca de não interpretar código como valor.
// As bordas (lookbehind/lookahead) impedem pegar PEDAÇO de um número maior: o "5" de "2025",
// o "01" do fim de um CNPJ "00.417.504/0001-01", o "1" de "1.2345". O "-" FINAL é o sinal de
// crédito dos balancetes ("2.559.778,50-"): fica no próprio número, senão seria roubado pelo
// número seguinte da linha como se fosse um "-" inicial.
const NUMBER_TOKEN_RE = /(?<![\d,/])(?<!\d-)\(?-?\s?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\)?-?(?![\d/]|[.,]\d)/g

// Um ano de 4 dígitos solto (1990-2099), como nos cabeçalhos "Set/2024  Dez/2023".
const YEAR_RE = /(?<!\d)(?:19|20)\d{2}(?!\d)/g

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

function numberTokens(text: string): RegExpExecArray[] {
  return [...text.matchAll(NUMBER_TOKEN_RE)].filter((m) => {
    const afterEnd = m.index + m[0].length
    return text[afterEnd] !== "%"
  })
}

// Cabeçalho de colunas por exercício ("Sld.de Setembro 2024 -- Sld.de Dezembro 2023"): linha com 2+ anos
// diferentes e nenhum valor. Devolve em que coluna, contando da DIREITA (0 = última), está o exercício mais
// recente — há contadores que põem o ano atual à esquerda. Qualquer outra linha: null.
export function newestColumnFromRight(line: string): number | null {
  if (numberTokens(line).length > 0) return null
  const years = [...line.matchAll(YEAR_RE)].map((m) => Number(m[0]))
  if (new Set(years).size < 2) return null
  return years.length - 1 - years.indexOf(Math.max(...years))
}

// O rótulo é o texto ANTES da primeira coluna numérica (depois de tirar um eventual
// código de conta no início, ex. "1.1.1"); o valor é, por padrão, a ÚLTIMA coluna numérica
// da linha. Com `columnFromRight` (vindo do cabeçalho, ver `newestColumnFromRight`) pega a
// coluna do exercício mais recente; se a linha tiver menos colunas que isso, fica a última.
// Separar assim (primeira ↔ nome, coluna escolhida ↔ valor) evita "limpar" números do rótulo.
export function extractLabelAndValue(line: string, columnFromRight = 0): LabelAndValue | null {
  const withoutCode = line.replace(/^\s*\d+(?:\.\d+)*\s+/, "")

  const matches = numberTokens(withoutCode)
  if (matches.length === 0) return null

  const index = matches.length > columnFromRight ? matches.length - 1 - columnFromRight : matches.length - 1
  const value = parseNumberToken(matches[index][0])
  if (!Number.isFinite(value)) return null

  let label = withoutCode.slice(0, matches[0].index)
  label = label.replace(/[.\-·\s]{2,}$/, "").trim() // remove pontilhado que liga nome ao valor
  if (label.length < 3) return null

  return { label, value }
}
