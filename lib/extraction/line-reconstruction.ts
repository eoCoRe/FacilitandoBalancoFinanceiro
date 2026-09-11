// Reagrupa itens de texto posicionados (x/y, como o pdfjs devolve) em linhas visuais.
// Necessário porque um PDF não guarda "tabela" — só texto solto com coordenada — e ler o
// texto na ordem em que o PDF o declara pode intercalar colunas de uma tabela.
// Função pura (sem pdfjs), testável com dados sintéticos.

export interface PositionedItem {
  text: string
  x: number
  y: number
}

export function reconstructLines(items: PositionedItem[], yTolerance = 2): string[] {
  if (items.length === 0) return []

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: PositionedItem[][] = []

  for (const item of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - item.y) <= yTolerance)
    if (line) line.push(item)
    else lines.push([item])
  }

  return lines.map((line) =>
    line
      .sort((a, b) => a.x - b.x)
      .map((i) => i.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}
