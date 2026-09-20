// Tradução entre o que as rotas de /api devolvem (ids numéricos, Decimal, datas ISO) e o modelo
// que as telas já consomem (Account por código, valores por período, StaticLine...). Tudo aqui
// é puro — sem fetch e sem React — para poder ser testado sem navegador nem banco.

import {
  DFC_LINE_KINDS,
  type Account,
  type DreValues,
  type StaticLine,
} from "./financial-data"
import type { UserIdentity } from "./permissions"
import { DEFAULT_SECTOR_ID, SECTORS } from "./sector-benchmarks"

export interface Exercicio {
  id: string
  label: string
  auditado: boolean
}

export interface AuditEntry {
  id: string
  timestamp: string
  user: string
  action: string
  detail: string
}

// ---- Formatos das respostas (espelham app/api/*) ----

export interface AuthUser extends UserIdentity {
  doisFatoresAtivo: boolean
  doisFatoresObrigatorio: boolean
}

export interface EmpresaPayload {
  id: number
  cnpj: string
  razaoSocial: string
  setor: string | null
  exercicios: { id: number; periodo: string; auditado: boolean }[]
}

export interface ContaNodePayload {
  id: number
  codigo: string
  descricao: string
  ehGrupo: boolean
  valores: Record<string, number>
  subcontas?: ContaNodePayload[]
}

export interface DrePayload {
  linhas: { id: string; name: string; kind: "input" | "computed"; contaId: number | null }[]
  valoresPorExercicio: Record<string, Record<string, number | undefined>>
}

export interface DfcPayload {
  linhas: { id: number; codigo: string; descricao: string; valores: Record<string, number> }[]
}

export interface AuditoriaPayload {
  logs: { id: number; usuario: string; acao: string; detalhe: string; criadoEm: string }[]
}

// ---- Snapshot que alimenta o store ----

export interface FinancialSnapshot {
  user: AuthUser
  companyName: string
  cnpj: string
  sectorId: string
  exercicios: Exercicio[]
  accounts: Account[]
  dreByExercicio: Record<string, DreValues>
  dfc: StaticLine[]
  auditLog: AuditEntry[]
}

// O store trabalha com códigos/períodos (a chave que as telas usam); a API, com ids de banco.
// Estes índices fazem a ponte na hora de gravar.
export interface IdIndex {
  exercicioIdByPeriodo: Record<string, number>
  contaIdByCode: Record<string, number>
  dreContaIdByLine: Record<string, number>
}

// "1.10" vem antes de "1.2" na ordenação por texto que o banco faz; aqui compara por segmento numérico.
export function compareCodes(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? -1) - (pb[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

export function mapContas(nodes: ContaNodePayload[]): { accounts: Account[]; contaIdByCode: Record<string, number> } {
  const contaIdByCode: Record<string, number> = {}

  function toAccount(node: ContaNodePayload): Account {
    contaIdByCode[node.codigo] = node.id
    // Grupo = `children` (mesmo vazio); analítica = `values` (mesmo vazio, "não preenchido").
    if (node.ehGrupo || (node.subcontas?.length ?? 0) > 0) {
      const children = [...(node.subcontas ?? [])].sort((a, b) => compareCodes(a.codigo, b.codigo)).map(toAccount)
      return { code: node.codigo, name: node.descricao, children }
    }
    return { code: node.codigo, name: node.descricao, values: { ...node.valores } }
  }

  const accounts = [...nodes].sort((a, b) => compareCodes(a.codigo, b.codigo)).map(toAccount)
  return { accounts, contaIdByCode }
}

// A API devolve a DRE já com os totalizadores; o store guarda só as linhas de entrada, porque
// computeDre() recalcula o resto na tela, no mesmo instante em que o valor é editado.
export function mapDre(payload: DrePayload): { dreByExercicio: Record<string, DreValues>; dreContaIdByLine: Record<string, number> } {
  const inputIds = new Set(payload.linhas.filter((l) => l.kind === "input").map((l) => l.id))
  const dreContaIdByLine: Record<string, number> = {}
  for (const linha of payload.linhas) {
    if (linha.contaId !== null) dreContaIdByLine[linha.id] = linha.contaId
  }

  const dreByExercicio: Record<string, DreValues> = {}
  for (const [periodo, valores] of Object.entries(payload.valoresPorExercicio)) {
    const inputs: DreValues = {}
    for (const [lineId, value] of Object.entries(valores)) {
      if (inputIds.has(lineId) && value !== undefined && value !== null) inputs[lineId] = value
    }
    dreByExercicio[periodo] = inputs
  }
  return { dreByExercicio, dreContaIdByLine }
}

export function mapDfc(payload: DfcPayload): StaticLine[] {
  return payload.linhas.map((linha) => ({
    name: linha.descricao,
    values: { ...linha.valores },
    kind: DFC_LINE_KINDS[linha.descricao] ?? "line",
  }))
}

export function mapAuditoria(payload: AuditoriaPayload): AuditEntry[] {
  return payload.logs.map((log) => ({
    id: String(log.id),
    timestamp: log.criadoEm,
    user: log.usuario,
    action: log.acao,
    detail: log.detalhe,
  }))
}

// O banco guarda o rótulo do setor ("Comércio Varejista"); as telas usam o id ("comercio-varejista").
export function sectorIdFromLabel(label: string | null): string {
  return SECTORS.find((s) => s.label === label)?.id ?? DEFAULT_SECTOR_ID
}

export function mapSnapshot(payloads: {
  me: { user: AuthUser }
  empresa: EmpresaPayload
  contas: { contas: ContaNodePayload[] }
  dre: DrePayload
  dfc: DfcPayload
  auditoria: AuditoriaPayload
}): { snapshot: FinancialSnapshot; ids: IdIndex } {
  const { empresa } = payloads
  const { accounts, contaIdByCode } = mapContas(payloads.contas.contas)
  const { dreByExercicio, dreContaIdByLine } = mapDre(payloads.dre)

  const exercicioIdByPeriodo: Record<string, number> = {}
  for (const ex of empresa.exercicios) exercicioIdByPeriodo[ex.periodo] = ex.id

  return {
    snapshot: {
      user: payloads.me.user,
      companyName: empresa.razaoSocial,
      cnpj: empresa.cnpj,
      sectorId: sectorIdFromLabel(empresa.setor),
      exercicios: empresa.exercicios.map((ex) => ({ id: ex.periodo, label: ex.periodo, auditado: ex.auditado })),
      accounts,
      dreByExercicio,
      dfc: mapDfc(payloads.dfc),
      auditLog: mapAuditoria(payloads.auditoria),
    },
    ids: { exercicioIdByPeriodo, contaIdByCode, dreContaIdByLine },
  }
}
