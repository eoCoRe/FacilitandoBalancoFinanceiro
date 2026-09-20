import { describe, expect, it } from "vitest"
import {
  computeDre,
  createSeedAccounts,
  createSeedDfc,
  createSeedDre,
  flattenAccounts,
  INDICATORS,
  makeIndicatorContext,
  SEED_EXERCICIOS,
  sumAccount,
  type Account,
} from "./financial-data"
import { balancoCsv, balanceteCsv, dfcCsv, dreCsv, exportFileName, indicesCsv } from "./export-csv"

const accounts = createSeedAccounts()
const dre = createSeedDre()
const ids = SEED_EXERCICIOS

// CSV -> matriz de células (sem BOM, separador ;). As células do seed não têm ; nem aspas, então o corte é seguro.
function parse(csv: string): string[][] {
  return csv
    .replace(String.fromCharCode(0xfeff), "")
    .trim()
    .split(String.fromCharCode(13, 10))
    .map((line) => line.split(";").map((cell) => cell.replace(/^"|"$/g, "")))
}

describe("balancoCsv", () => {
  const rows = parse(balancoCsv(accounts, ids, "milhares"))

  it("uma linha por conta (árvore inteira) mais o cabeçalho, com a unidade em cada exercício", () => {
    expect(rows).toHaveLength(flattenAccounts(accounts).length + 1)
    expect(rows[0]).toEqual(["Código", "Conta", "Nível", "4T2024 (R$ mil)", "1T2025 (R$ mil)", "1T2026 (R$ mil)"])
  })

  it("os totais dos grupos batem com o motor de cálculo (não são recalculados à parte)", () => {
    const ativo = accounts.find((a) => a.name === "Ativo")!
    const linha = rows.find((r) => r[1] === "Ativo")!
    expect(linha.slice(3)).toEqual(ids.map((id) => String(sumAccount(ativo, id)).replace(".", ",")))
  })

  it("aplica a escala escolhida: unidade multiplica por mil, milhões divide", () => {
    const disp = (escala: "unidade" | "milhoes") =>
      parse(balancoCsv(accounts, ids, escala)).find((r) => r[1] === "Disponibilidades")!
    expect(disp("unidade")[5]).toBe("1050000") // 1T2026: 1050 mil
    expect(disp("milhoes")[5]).toBe("1,05")
    expect(parse(balancoCsv(accounts, ids, "unidade"))[0][3]).toBe("4T2024 (R$)")
  })

  it("dado ausente sai VAZIO (RN04: nunca vira zero)", () => {
    const parcial: Account[] = [{ code: "1", name: "Ativo", values: { "1T2026": 10 } }]
    const linha = parse(balancoCsv(parcial, ["4T2024", "1T2026"], "milhares"))[1]
    expect(linha.slice(3)).toEqual(["", "10"])
  })

  it("valor NEGATIVO (prejuízo, patrimônio líquido negativo) sai como número, sem apóstrofo de texto", () => {
    const negativa: Account[] = [{ code: "1", name: "Resultado", values: { "1T2026": -1050.5 } }]
    const csv = balancoCsv(negativa, ["1T2026"], "milhares")
    expect(csv).toContain('"-1050,5"')
    expect(csv).not.toContain(`'-`)
  })

  it("nome de conta digitado por um usuário não vira fórmula na planilha", () => {
    const perigosa: Account[] = [{ code: "1", name: "=HYPERLINK(\"http://evil.example\")", values: { "1T2026": 1 } }]
    expect(balancoCsv(perigosa, ["1T2026"], "milhares")).toContain(`"'=HYPERLINK(`)
  })

  it("começa com BOM e usa ponto e vírgula", () => {
    const csv = balancoCsv(accounts, ids, "milhares")
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.split(String.fromCharCode(13, 10))[0]).toContain('";"')
  })
})

describe("dreCsv", () => {
  it("traz os totalizadores calculados pelo mesmo motor da tela", () => {
    const rows = parse(dreCsv(dre, ids, "milhares"))
    const esperado = computeDre(dre["1T2026"])["receita-liquida"]!
    expect(rows.find((r) => r[0] === "Receita Líquida")![3]).toBe(String(esperado).replace(".", ","))
  })

  it("inclui a linha informativa de Compras e todas as linhas da DRE", () => {
    const rows = parse(dreCsv(dre, ids, "milhares"))
    expect(rows.some((r) => r[0].startsWith("Compras"))).toBe(true)
    expect(rows.length).toBeGreaterThan(10)
  })

  it("exercício sem nenhum valor lançado sai com células vazias", () => {
    const rows = parse(dreCsv({}, ["2T2030"], "milhares"))
    expect(rows.slice(1).every((r) => r[1] === "")).toBe(true)
  })
})

describe("dfcCsv e balanceteCsv", () => {
  it("DFC: uma linha por linha do demonstrativo", () => {
    const rows = parse(dfcCsv(createSeedDfc(), ids, "milhares"))
    expect(rows).toHaveLength(createSeedDfc().length + 1)
    expect(rows.find((r) => r[0] === "Caixa no Fim do Período")![3]).toBe("1050")
  })

  it("balancete: só contas analíticas, saldo do exercício pedido", () => {
    const rows = parse(balanceteCsv(accounts, "1T2026", "milhares"))
    expect(rows[0]).toEqual(["Código", "Conta", "Saldo 1T2026 (R$ mil)"])
    expect(rows.find((r) => r[1] === "Disponibilidades")).toEqual(["1.1.1", "Disponibilidades", "1050"])
    expect(rows.some((r) => r[1] === "Ativo")).toBe(false) // grupo não entra
  })

  it("balancete sem exercício: saldo vazio, sem quebrar", () => {
    const rows = parse(balanceteCsv(accounts, undefined, "milhares"))
    expect(rows[0][2]).toBe("Saldo")
    expect(rows[1][2]).toBe("")
  })
})

describe("indicesCsv", () => {
  const rows = parse(indicesCsv(accounts, dre, ids))

  it("uma linha por índice do catálogo, com grupo, fórmula e unidade", () => {
    expect(rows[0]).toEqual(["Grupo", "Índice", "Fórmula", "Unidade", ...ids])
    expect(rows).toHaveLength(INDICATORS.length + 1)
  })

  it("o valor exportado é o do motor de índices (com vírgula decimal)", () => {
    const indicador = INDICATORS.find((i) => i.id === "liquidez-corrente")!
    const esperado = indicador.compute(makeIndicatorContext(accounts, computeDre(dre["1T2026"]), "1T2026"))!
    const linha = rows.find((r) => r[1] === "Liquidez Corrente")!
    expect(Number(linha[6].replace(",", "."))).toBeCloseTo(esperado, 3)
  })

  it("índice sem dados suficientes sai vazio, não zero nem 'NaN'", () => {
    const vazio = parse(indicesCsv([], {}, ["2T2030"]))
    expect(vazio.slice(1).every((r) => r[4] === "")).toBe(true)
  })
})

describe("exportFileName", () => {
  it("normaliza o nome da empresa (sem acento, minúsculas, hífens) e põe a data", () => {
    expect(exportFileName("balanco", "Farmácia Bem-Estar Ltda", new Date("2026-09-20T12:00:00Z"))).toBe(
      "farmacia-bem-estar-ltda-balanco-2026-09-20.csv",
    )
  })

  it("nome vazio ou só símbolos cai num padrão seguro", () => {
    expect(exportFileName("dre", "!!!", new Date("2026-09-20T12:00:00Z"))).toBe("empresa-dre-2026-09-20.csv")
  })
})
