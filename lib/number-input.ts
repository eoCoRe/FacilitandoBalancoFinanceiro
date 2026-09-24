// Campos de valor digitados à mão, no formato brasileiro: ponto é separador de milhar e vírgula é decimal.
// Puro (sem React), usado pela Tabulação e pela revisão da Extração.

// "12.663.067,45" → 12663067.45; "-1.200" → -1200. Vazio ou texto que não é número → null (quem chama decide se
// vazio apaga o valor).
export function parseBrNumber(text: string): number | null {
  const cleaned = text.replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

// Valor → texto para EDITAR: vírgula decimal e sem separador de milhar (que atrapalharia a edição), para que ler de
// volta com `parseBrNumber` dê o mesmo número. String(12663.07) daria "12663.07", que seria lido como 1266307.
export function formatBrNumberForInput(value: number | undefined): string {
  return value === undefined ? "" : String(value).replace(".", ",")
}
