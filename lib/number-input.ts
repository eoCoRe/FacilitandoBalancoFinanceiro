// Campos de valor digitados à mão, no formato brasileiro: ponto é separador de milhar e vírgula é decimal.
// Puro (sem React), usado pela Tabulação e pela revisão da Extração.

// "12.663.067,45" → 12663067.45; "-1.200" → -1200. Vazio ou texto que não é número → null (quem chama decide se
// vazio apaga o valor).
export function parseBrNumber(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

// Campo que aceita uma conta simples, para balanço que traz "um campo menos outro" (ex.: imobilizado bruto menos a
// depreciação): "4.133.297,81 - 3.152.704,65", "1.000 + 250,5". Só soma e subtração; valor entre parênteses é
// negativo, como nos demonstrativos ("(1.200,00)"). Vazio ou inválido → null.
export function parseExpressao(text: string): number | null {
  const semEspaco = text.replace(/\s/g, "")
  if (semEspaco === "") return null
  const termos = semEspaco.match(/^[+-]?(\([\d.,]+\)|[\d.,]+)([+-](\([\d.,]+\)|[\d.,]+))*$/) ? semEspaco.match(/[+-]?(\([\d.,]+\)|[\d.,]+)/g) : null
  if (!termos) return null
  let total = 0
  for (const termo of termos) {
    const sinal = termo.startsWith("-") ? -1 : 1
    const corpo = termo.replace(/^[+-]/, "")
    const entreParenteses = corpo.startsWith("(")
    const valor = parseBrNumber(corpo.replace(/[()]/g, ""))
    if (valor === null) return null
    total += sinal * (entreParenteses ? -valor : valor)
  }
  return Math.round(total * 100) / 100
}

// Valor → texto para EDITAR: vírgula decimal e sem separador de milhar (que atrapalharia a edição), para que ler de
// volta com `parseBrNumber` dê o mesmo número. String(12663.07) daria "12663.07", que seria lido como 1266307.
export function formatBrNumberForInput(value: number | undefined): string {
  return value === undefined ? "" : String(value).replace(".", ",")
}
