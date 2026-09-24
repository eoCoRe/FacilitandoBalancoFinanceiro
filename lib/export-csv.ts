// Exportação das demonstrações e dos índices em CSV (para abrir no Excel). Puro: recebe os mesmos dados
// que as telas já têm na memória e devolve o texto do arquivo — nada passa pelo servidor.
//
// Regras: os números saem como número (não como texto formatado "1.050"), na escala escolhida na tela, com
// vírgula decimal (o Excel em português entende); célula sem dado (RN04, "dados insuficientes") sai VAZIA,
// nunca zero; e o cabeçalho de cada exercício diz a unidade ("1T2026 (R$ mil)").

import { basesVerticaisBalanco, percentual, variacao, type ModoAnalise } from "./analise-hv"
import { toCsv } from "./csv"
import {
  applyScale,
  collectLeaves,
  computeDre,
  DRE_LINES,
  DRE_MEMO_LINE,
  flattenAccounts,
  INDICATORS,
  makeIndicatorContext,
  sumAccount,
  type Account,
  type DreValues,
  type IndicatorUnit,
  type Scale,
  type StaticLine,
} from "./financial-data"

const UNIT_LABEL: Record<Scale, string> = { unidade: "R$", milhares: "R$ mil", milhoes: "R$ milhões" }
const INDICATOR_UNIT_LABEL: Record<IndicatorUnit, string> = { ratio: "índice", percent: "%", dias: "dias" }

// Número -> texto com vírgula decimal, sem ruído de ponto flutuante (1050 * 0.001 = 1.0500000000000001).
function num(value: number | undefined, digits = 6): string {
  if (value === undefined || !Number.isFinite(value)) return ""
  return String(Number(value.toFixed(digits))).replace(".", ",")
}

const scaled = (value: number | undefined, scale: Scale): string =>
  value === undefined ? "" : num(applyScale(value, scale))

const periodHeader = (id: string, scale: Scale): string => `${id} (${UNIT_LABEL[scale]})`

// Com AV ou AH na tela, o arquivo leva os valores E as colunas de percentual do modo (uma por exercício; na AH o primeiro
// exercício não tem anterior e fica vazio).
const analiseHeaders = (ids: string[], modo: ModoAnalise): string[] =>
  modo === "valores" ? [] : ids.map((id) => `${id} (${modo === "av" ? "AV" : "AH"} %)`)

export function balancoCsv(accounts: Account[], exercicioIds: string[], scale: Scale, modo: ModoAnalise = "valores"): string {
  const bases = Object.fromEntries(exercicioIds.map((id) => [id, basesVerticaisBalanco(accounts, id)]))
  const analise = (account: Account): string[] =>
    modo === "valores"
      ? []
      : exercicioIds.map((id, i) =>
          num(
            modo === "av"
              ? percentual(sumAccount(account, id), bases[id].get(account.code))
              : i === 0
                ? undefined
                : variacao(sumAccount(account, id), sumAccount(account, exercicioIds[i - 1])),
            1,
          ),
        )
  const rows = flattenAccounts(accounts).map(({ account, depth }) => [
    account.code,
    account.name,
    depth,
    ...exercicioIds.map((id) => scaled(sumAccount(account, id), scale)),
    ...analise(account),
  ])
  return toCsv(["Código", "Conta", "Nível", ...exercicioIds.map((id) => periodHeader(id, scale)), ...analiseHeaders(exercicioIds, modo)], rows)
}

export function dreCsv(dreByExercicio: Record<string, DreValues>, exercicioIds: string[], scale: Scale, modo: ModoAnalise = "valores"): string {
  const computed = Object.fromEntries(exercicioIds.map((id) => [id, computeDre(dreByExercicio[id] ?? {})]))
  const lines = [...DRE_LINES.map((l) => ({ id: l.id, name: l.name })), { id: DRE_MEMO_LINE.id, name: DRE_MEMO_LINE.name }]
  const analise = (lineId: string): string[] =>
    modo === "valores"
      ? []
      : exercicioIds.map((id, i) =>
          num(
            modo === "av"
              ? percentual(computed[id][lineId], computed[id]["receita-liquida"])
              : i === 0
                ? undefined
                : variacao(computed[id][lineId], computed[exercicioIds[i - 1]][lineId]),
            1,
          ),
        )
  const rows = lines.map((line) => [line.name, ...exercicioIds.map((id) => scaled(computed[id][line.id], scale)), ...analise(line.id)])
  return toCsv(["Descrição", ...exercicioIds.map((id) => periodHeader(id, scale)), ...analiseHeaders(exercicioIds, modo)], rows)
}

export function dfcCsv(lines: StaticLine[], exercicioIds: string[], scale: Scale): string {
  const rows = lines.map((line) => [line.name, ...exercicioIds.map((id) => scaled(line.values[id], scale))])
  return toCsv(["Descrição", ...exercicioIds.map((id) => periodHeader(id, scale))], rows)
}

// Balancete: saldo de cada conta analítica (folha) em um único exercício.
export function balanceteCsv(accounts: Account[], period: string | undefined, scale: Scale): string {
  const rows = collectLeaves(accounts).map((account) => [
    account.code,
    account.name,
    period ? scaled(sumAccount(account, period), scale) : "",
  ])
  return toCsv(["Código", "Conta", period ? `Saldo ${periodHeader(period, scale)}` : "Saldo"], rows)
}

export function indicesCsv(accounts: Account[], dreByExercicio: Record<string, DreValues>, exercicioIds: string[]): string {
  const contexts = exercicioIds.map((id) => makeIndicatorContext(accounts, computeDre(dreByExercicio[id] ?? {}), id))
  const rows = INDICATORS.map((indicator) => [
    indicator.group,
    indicator.name,
    indicator.formula,
    INDICATOR_UNIT_LABEL[indicator.unit],
    ...contexts.map((ctx) => num(indicator.compute(ctx), 4)),
  ])
  return toCsv(["Grupo", "Índice", "Fórmula", "Unidade", ...exercicioIds], rows)
}

// Nome do arquivo baixado: "farmacia-bem-estar-ltda-balanco-2026-09-20.csv".
export function exportFileName(kind: string, companyName: string, now: Date = new Date()): string {
  const slug =
    companyName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "empresa"
  // Dia LOCAL (não o UTC): às 22h em Brasília o UTC já é o dia seguinte, e o arquivo sairia com a data de amanhã.
  const dia = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  return `${slug}-${kind}-${dia}.csv`
}
