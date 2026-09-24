import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"
import { collectLeaves, createSeedAccounts } from "@/lib/financial-data"
import { reconstructLines, type PositionedItem } from "@/lib/extraction/line-reconstruction"
import { detectUnit, dreExtractionTargets, dreLineIdFromCode, extractRowsFromLines } from "@/lib/extraction/pdf-extraction"

// Mede o leitor local de PDF num conjunto de balanços reais, sem banco e sem navegador: roda o MESMO código da tela
// Extração (lib/extraction/) sobre o Plano de Contas padrão e diz quanto de cada documento ele reconheceu. Serve para
// comparar versões do leitor e para relatar resultados. Os documentos NÃO são enviados a lugar nenhum.
//
//   pnpm avaliar:extracao balanco1.pdf balanco2.pdf [--detalhe] [--csv resultado.csv]
//
// "Cobertura" = contas analíticas do Plano de Contas (ou linhas de entrada da DRE) que receberam um valor. Não confere
// se o valor está CERTO — isso é a revisão do analista (human-in-the-loop); use --detalhe para conferir à mão.

const args = process.argv.slice(2)
const detalhe = args.includes("--detalhe")
const csvIndex = args.indexOf("--csv")
const csvPath = csvIndex >= 0 ? args[csvIndex + 1] : null
const arquivos = args.filter((a, i) => !a.startsWith("--") && (csvIndex < 0 || i !== csvIndex + 1))

if (arquivos.length === 0) {
  console.error("Uso: pnpm avaliar:extracao <arquivo.pdf> [...] [--detalhe] [--csv saida.csv]")
  process.exit(1)
}

async function lerLinhas(path: string) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise
  const lines: { text: string; page: number }[] = []
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent()
    const items: PositionedItem[] = content.items.flatMap((item) =>
      "str" in item && item.str.trim() ? [{ text: item.str, x: item.transform[4], y: item.transform[5] }] : [],
    )
    for (const text of reconstructLines(items)) lines.push({ text, page })
  }
  return { paginas: doc.numPages, lines }
}

const accounts = createSeedAccounts()
const totalBp = collectLeaves(accounts).length
const totalDre = dreExtractionTargets().length
const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`)

async function main() {
  const resultados = []
  for (const path of arquivos) {
    const { paginas, lines } = await lerLinhas(path)
    const rows = extractRowsFromLines(lines, accounts)
    const comConta = rows.filter((r) => r.code)
    const dre = comConta.filter((r) => dreLineIdFromCode(r.code!) !== null)
    const bp = comConta.length - dre.length
    const confianca = comConta.length ? Math.round(comConta.reduce((s, r) => s + r.confidence, 0) / comConta.length) : 0
    const r = {
      arquivo: basename(path),
      paginas,
      semTexto: lines.length === 0,
      unidade: detectUnit(lines),
      linhasComValor: rows.length,
      bp,
      dre: dre.length,
      semConta: rows.length - comConta.length,
      confianca,
    }
    resultados.push(r)

    console.log(`\n${r.arquivo} — ${paginas} página(s), unidade: ${r.unidade}${r.semTexto ? " — SEM TEXTO (PDF escaneado: precisa de OCR)" : ""}`)
    console.log(
      `  Balanço ${bp}/${totalBp} (${pct(bp, totalBp)}) · DRE ${dre.length}/${totalDre} (${pct(dre.length, totalDre)}) · ` +
        `${r.semConta} linha(s) sem conta · confiança média ${confianca}%`,
    )
    if (detalhe) {
      for (const row of comConta) console.log(`    ✔ ${row.suggestedName}  ←  "${row.sourceLabel}" = ${row.value} (p${row.page}, ${row.confidence}%)`)
      for (const row of rows.filter((x) => !x.code)) console.log(`    · sem conta: "${row.sourceLabel}" = ${row.value} (p${row.page})`)
    }
  }

  const somaBp = resultados.reduce((s, r) => s + r.bp, 0)
  const somaDre = resultados.reduce((s, r) => s + r.dre, 0)
  const comDre = resultados.filter((r) => r.dre > 0).length
  console.log(
    `\nTotal: ${resultados.length} documento(s) · Balanço ${pct(somaBp, totalBp * resultados.length)} das contas · ` +
      (comDre === 0 ? "nenhum com DRE" : `DRE ${pct(somaDre, totalDre * comDre)} das linhas (nos ${comDre} documento(s) com DRE)`),
  )

  if (csvPath) {
    const header = "arquivo;paginas;unidade;linhas_com_valor;contas_balanco;contas_balanco_total;linhas_dre;linhas_dre_total;sem_conta;confianca_media"
    const linhas = resultados.map((r) =>
      [r.arquivo, r.paginas, r.unidade, r.linhasComValor, r.bp, totalBp, r.dre, totalDre, r.semConta, r.confianca].join(";"),
    )
    writeFileSync(csvPath, "﻿" + [header, ...linhas].join("\r\n") + "\r\n")
    console.log(`CSV gravado em ${csvPath}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
