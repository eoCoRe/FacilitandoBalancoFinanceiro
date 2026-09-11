"use client"

// Camada fina sobre o pdfjs-dist: só lê o texto e a posição de cada item do PDF.
// Roda inteiramente no navegador (WASM/JS do próprio pacote, sem chamada de rede) — o
// worker é servido do mesmo bundle via `new URL(..., import.meta.url)`, nunca de um CDN.
// Import dinâmico de propósito: evita carregar o pdfjs (e ele tentar detectar um
// ambiente Node durante o build/SSR) fora do momento em que o usuário de fato envia um
// arquivo no navegador.

import type { TextItem } from "pdfjs-dist/types/src/display/api"
import { reconstructLines, type PositionedItem } from "./line-reconstruction"

export interface PdfLine {
  text: string
  page: number
}

export interface PdfTextResult {
  hasText: boolean
  lines: PdfLine[]
}

function isTextItem(item: TextItem | { type: string }): item is TextItem {
  return "str" in item
}

export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

  const buffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: buffer })
  const doc = await loadingTask.promise
  const lines: PdfLine[] = []
  let hasText = false

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      const items: PositionedItem[] = content.items.filter(isTextItem).flatMap((item) => {
        if (!item.str.trim()) return []
        return [{ text: item.str, x: item.transform[4], y: item.transform[5] }]
      })
      if (items.length > 0) hasText = true
      for (const line of reconstructLines(items)) {
        lines.push({ text: line, page: pageNum })
      }
    }
  } finally {
    await loadingTask.destroy()
  }

  return { hasText, lines }
}
