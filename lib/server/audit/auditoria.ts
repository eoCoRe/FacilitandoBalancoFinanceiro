import type { Prisma } from "@prisma/client"
import { requirePositiveInt, ValidationError } from "@/lib/server/validation"

export const AUDIT_PAGE_DEFAULT = 50
export const AUDIT_PAGE_MAX = 200
export const AUDIT_EXPORT_MAX = 10_000

function optionalText(params: URLSearchParams, name: string, max: number): string | null {
  const raw = params.get(name)
  if (raw === null || raw.trim() === "") return null
  const value = raw.trim()
  if (value.length > max) throw new ValidationError(`${name} deve ter no máximo ${max} caracteres.`)
  return value
}

function optionalDate(params: URLSearchParams, name: string): Date | null {
  const raw = optionalText(params, name, 40)
  if (raw === null) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${name} não é uma data válida.`)
  return date
}

export interface AuditQuery {
  where: Prisma.AuditLogWhereInput
  limite: number
  // Filtros aplicados, em texto, para registrar na auditoria uma exportação.
  resumo: string
}

// Traduz a query string em filtro do Prisma. Toda entrada é validada (tamanho, tipo, data) e os
// textos vão sempre como valor parametrizado — nunca concatenados em SQL. Sem filtros, o `where`
// é só { empresaId }.
export function parseAuditQuery(params: URLSearchParams, empresaId: number): AuditQuery {
  const where: Prisma.AuditLogWhereInput = { empresaId }
  const resumo: string[] = []

  const rawLimite = params.get("limite")
  let limite = AUDIT_PAGE_DEFAULT
  if (rawLimite !== null && rawLimite !== "") {
    limite = Math.min(requirePositiveInt(Number(rawLimite), "limite"), AUDIT_PAGE_MAX)
  }

  const rawCursor = params.get("cursor")
  if (rawCursor !== null && rawCursor !== "") {
    where.id = { lt: requirePositiveInt(Number(rawCursor), "cursor") }
  }

  const usuario = optionalText(params, "usuario", 254)
  if (usuario) {
    where.usuario = { contains: usuario, mode: "insensitive" }
    resumo.push(`usuário contém "${usuario}"`)
  }

  const acao = optionalText(params, "acao", 100)
  if (acao) {
    where.acao = acao
    resumo.push(`ação = "${acao}"`)
  }

  const de = optionalDate(params, "de")
  const ate = optionalDate(params, "ate")
  if (de || ate) {
    if (de && ate && de > ate) throw new ValidationError("A data inicial não pode ser depois da final.")
    where.criadoEm = { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) }
    if (de) resumo.push(`de ${de.toISOString()}`)
    if (ate) resumo.push(`até ${ate.toISOString()}`)
  }

  const q = optionalText(params, "q", 100)
  if (q) {
    where.OR = [
      { detalhe: { contains: q, mode: "insensitive" } },
      { acao: { contains: q, mode: "insensitive" } },
      { usuario: { contains: q, mode: "insensitive" } },
    ]
    resumo.push(`busca "${q}"`)
  }

  return { where, limite, resumo: resumo.length ? resumo.join("; ") : "sem filtros" }
}
