import { createHmac, timingSafeEqual } from "node:crypto"
import { prisma } from "@/lib/db"
import { getAuthSecret } from "./session"

// Integridade da trilha de auditoria (RNF03). Cada registro recebe um selo: HMAC-SHA256 dos seus campos
// encadeado ao selo do registro anterior. Assim:
//  - editar qualquer campo de um registro selado muda o selo dele → a verificação aponta o registro;
//  - apagar (ou inserir) um registro no meio quebra o encadeamento no registro seguinte;
//  - quem só tem acesso ao banco não consegue refazer os selos, porque a chave (AUDIT_SEAL_SECRET, ou
//    AUTH_SECRET se ela não existir) não está no banco.
// Limites assumidos (também em SECURITY.md): apagar os registros mais RECENTES não é detectável sem uma
// âncora externa; o expurgo por retenção apaga os mais antigos e a verificação recomeça do primeiro que
// sobrou; registros que já existiam quando o recurso entrou foram selados na primeira execução, então o
// selo deles atesta o estado daquele momento, não o da criação.

// Trava que serializa a selagem entre requisições simultâneas (dois selando ao mesmo tempo bifurcariam a cadeia).
const SEAL_LOCK_KEY = 7_310_442
const SEAL_BATCH = 200
// Limite de lotes por chamada: quem grava um evento não deve ficar preso selando um histórico enorme.
const SEAL_MAX_BATCHES = 25

type SealFields = { id: number; empresaId: number; usuario: string; acao: string; detalhe: string; criadoEm: Date }

function sealKey(): Buffer {
  const dedicated = process.env.AUDIT_SEAL_SECRET
  if (dedicated) {
    if (dedicated.length < 32) throw new Error("AUDIT_SEAL_SECRET deve ter pelo menos 32 caracteres.")
    return Buffer.from(dedicated)
  }
  return Buffer.from(getAuthSecret())
}

export function computeSeal(previousSeal: string | null, row: SealFields): string {
  const canonical = JSON.stringify([previousSeal ?? "", row.id, row.empresaId, row.criadoEm.toISOString(), row.usuario, row.acao, row.detalhe])
  return createHmac("sha256", sealKey()).update(`auditoria:v1:${canonical}`).digest("hex")
}

function sameSeal(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// Sela, em ordem de id, os registros que ainda não têm selo e vêm depois do último selado. Devolve quantos selou.
export async function sealPending(): Promise<number> {
  let sealed = 0
  for (let batch = 0; batch < SEAL_MAX_BATCHES; batch++) {
    const count = await prisma.$transaction(async (tx) => {
      // ::text porque o retorno da função é "void", que o driver não sabe ler.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEAL_LOCK_KEY})::text`
      const last = await tx.auditLog.findFirst({
        where: { selo: { not: null } },
        orderBy: { id: "desc" },
        select: { id: true, selo: true },
      })
      const pending = await tx.auditLog.findMany({
        where: { selo: null, ...(last ? { id: { gt: last.id } } : {}) },
        orderBy: { id: "asc" },
        take: SEAL_BATCH,
      })
      let previous = last?.selo ?? null
      for (const row of pending) {
        const selo = computeSeal(previous, row)
        await tx.auditLog.update({ where: { id: row.id }, data: { selo, seloAnterior: previous } })
        previous = selo
      }
      return pending.length
    })
    sealed += count
    if (count < SEAL_BATCH) break
  }
  return sealed
}

export interface IntegrityReport {
  integra: boolean
  // Registros com selo conferidos (do primeiro ao último selado).
  verificados: number
  // Registros sem selo (ex.: gravados fora da ordem, depois de um mais novo já selado).
  naoSelados: number
  primeiroId: number | null
  ultimoId: number | null
  // Primeiro problema encontrado, se houver.
  quebra: { id: number; motivo: string } | null
}

const VERIFY_PAGE = 1000

// Sela o que faltar e confere a cadeia inteira, do primeiro ao último registro selado.
export async function verifyAuditIntegrity(): Promise<IntegrityReport> {
  await sealPending()

  let verificados = 0
  let primeiroId: number | null = null
  let ultimoId: number | null = null
  let anterior: string | null = null
  let cursor = 0
  let quebra: IntegrityReport["quebra"] = null

  while (!quebra) {
    const rows = await prisma.auditLog.findMany({
      where: { selo: { not: null }, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: VERIFY_PAGE,
    })
    if (rows.length === 0) break

    for (const row of rows) {
      if (primeiroId === null) {
        primeiroId = row.id
        // O primeiro registro que sobrou é a âncora: o selo anterior dele é aceito como está (o anterior pode
        // ter sido expurgado por retenção), mas o selo do próprio registro é conferido.
      } else if (row.seloAnterior !== anterior) {
        quebra = { id: row.id, motivo: "O encadeamento com o registro anterior não confere: há registro apagado ou inserido antes deste." }
        break
      }
      if (!sameSeal(row.selo, computeSeal(row.seloAnterior, row))) {
        quebra = { id: row.id, motivo: "O conteúdo deste registro não confere com o selo: foi alterado depois de gravado." }
        break
      }
      anterior = row.selo
      ultimoId = row.id
      verificados++
    }
    cursor = rows[rows.length - 1].id
  }

  const naoSelados = await prisma.auditLog.count({ where: { selo: null } })
  return { integra: quebra === null, verificados, naoSelados, primeiroId, ultimoId, quebra }
}
