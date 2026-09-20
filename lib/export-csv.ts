// Exportação das demonstrações e dos índices em CSV (para abrir no Excel). Puro: recebe os mesmos dados
// que as telas já têm na memória e devolve o texto do arquivo — nada passa pelo servidor.
//
// Regras: os números saem como número (não como texto formatado "1.050"), na escala escolhida na tela, com
// vírgula decimal (o Excel em português entende); célula sem dado (RN04, "dados insuficientes") sai VAZIA,
// nunca zero; e o cabeçalho de cada exercício diz a unidade ("1T2026 (R$ mil)").

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

export function balancoCsv(accounts: Account[], exercicioIds: string[], scale: Scale): string {
  const rows = flattenAccounts(accounts).map(({ account, depth }) => [
    account.code,
    account.name,
    depth,
    ...exercicioIds.map((id) => scaled(sumAccount(account, id), scale)),
  ])
  return toCsv(["Código", "Conta", "Nível", ...exercicioIds.map((id) => periodHeader(id, scale))], rows)
}

export function dreCsv(dreByExercicio: Record<string, DreValues>, exercicioIds: string[], scale: Scale): string {
  const computed = Object.fromEntries(exercicioIds.map((id) => [id, computeDre(dreByExercicio[id] ?? {})]))
  const lines = [...DRE_LINES.map((l) => ({ id: l.id, name: l.name })), { id: DRE_MEMO_LINE.id, name: DRE_MEMO_LINE.name }]
  const rows = lines.map((line) => [line.name, ...exercicioIds.map((id) => scaled(computed[id][line.id], scale))])
  return toCsv(["Descrição", ...exercicioIds.map((id) => periodHeader(id, scale))], rows)
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
  return `${slug}-${kind}-${now.toISOString().slice(0, 10)}.csv`
}
