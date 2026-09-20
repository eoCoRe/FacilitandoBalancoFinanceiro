import { createHmac } from "node:crypto"
import { prisma } from "@/lib/db"
import { safeEqual } from "@/lib/server/auth/safe-equal"
import { getAuthSecret } from "@/lib/server/auth/session"

// Integridade da trilha de auditoria (RNF03). Cada registro recebe um selo: HMAC-SHA256 dos seus campos
// encadeado ao selo do registro anterior. Assim:
//  - editar qualquer campo de um registro selado muda o selo dele → a verificação aponta o registro;
//  - apagar (ou inserir) um registro no meio quebra o encadeamento no registro seguinte;
//  - quem só tem acesso ao banco não consegue refazer os selos, porque a chave (AUDIT_SEAL_SECRET, ou
//    AUTH_SECRET se ela não existir) não está no banco.
//
// QUEM SELA O QUÊ. O servidor só sela os registros que ELE MESMO acabou de gravar (o id vem do `create`, guardado na
// memória do processo até a selagem dar certo). Nada de "selar tudo que está sem selo": isso deixaria quem tem só o banco
// zerar os selos, editar os registros e fazer o próprio servidor carimbar o resultado — e nenhum critério guardado no banco
// (como a data do registro) serve para distinguir, porque quem escreve no banco também escreve nele. Registro sem selo
// que o servidor não gravou agora é PROBLEMA a apontar; quem decide selar um registro assim é o ADMINISTRADOR, por uma
// ação explícita que fica na trilha (POST /api/auditoria/selar-pendentes) — a recuperação de uma falha de selagem depois
// de reiniciar o processo, ou o histórico de uma instalação anterior à selagem (uma vez).
//
// Limites assumidos (também em SECURITY.md): apagar os registros mais RECENTES não é detectável sem uma âncora externa; o
// expurgo por retenção só apaga o começo da cadeia (ver retention.ts) e a verificação recomeça do primeiro que sobrou.

// Trava que serializa a selagem entre requisições simultâneas (dois selando ao mesmo tempo bifurcariam a cadeia).
const SEAL_LOCK_KEY = 7_310_442
const SEAL_BATCH = 100
// Cada lote é uma transação interativa (padrão do Prisma: 5 s). O tempo folgado evita que um banco lento ou remoto
// aborte o lote no meio e o refaça para sempre; a trava só é mantida enquanto o lote roda.
const SEAL_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 }
// Limite de lotes por chamada: quem grava um evento não deve ficar preso selando um histórico enorme.
const SEAL_MAX_BATCHES = 25
// Na VERIFICAÇÃO, registro sem selo mais novo que isto ainda pode estar sendo selado (por este ou por outro servidor);
// mais velho que isto é problema. O tempo só decide o que APONTAR — nunca o que o servidor carimba.
export const UNSEALED_TOLERANCE_MS = 2 * 60 * 1000

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

// Sela registros ainda sem selo e devolve quantos selou. A cadeia segue a ORDEM EM QUE OS SELOS SÃO GERADOS (selo_seq),
// não o id: se um registro de id menor só for confirmado depois de outro mais novo já selado (duas requisições
// simultâneas), ele entra no fim da cadeia — nunca fica sem selo.
//  - `ids`: só estes registros (o caminho normal: o que este processo acabou de gravar);
//  - `all`: TODOS os que estão sem selo (só a ação explícita do administrador, que fica registrada na trilha).
export async function sealPending({ ids, all = false }: { ids?: readonly number[]; all?: boolean } = {}): Promise<number> {
  if (!all && (!ids || ids.length === 0)) return 0
  let sealed = 0
  for (let batch = 0; batch < SEAL_MAX_BATCHES; batch++) {
    const count = await prisma.$transaction(async (tx) => {
      // ::text porque o retorno da função é "void", que o driver não sabe ler.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEAL_LOCK_KEY})::text`
      // Só posições preenchidas: no Postgres, ORDER BY ... DESC põe NULL primeiro, e um registro com selo mas sem posição
      // viraria o "último" e bagunçaria a cadeia.
      const last = await tx.auditLog.findFirst({
        where: { selo: { not: null }, seloSeq: { not: null } },
        orderBy: { seloSeq: "desc" },
        select: { selo: true, seloSeq: true },
      })
      const pending = await tx.auditLog.findMany({
        where: { selo: null, ...(all ? {} : { id: { in: [...(ids ?? [])] } }) },
        orderBy: { id: "asc" },
        take: SEAL_BATCH,
      })
      let previous = last?.selo ?? null
      let seq = last?.seloSeq ?? 0
      for (const row of pending) {
        const selo = computeSeal(previous, row)
        seq += 1
        await tx.auditLog.update({ where: { id: row.id }, data: { selo, seloAnterior: previous, seloSeq: seq } })
        previous = selo
      }
      return pending.length
    }, SEAL_TX_OPTIONS)
    sealed += count
    if (count < SEAL_BATCH) break
  }
  return sealed
}

// Registros que ESTE processo gravou e ainda não conseguiu selar. Vive na memória do processo de propósito: é a única
// prova de "fui eu que gravei" que quem só tem acesso ao banco não consegue forjar.
const ownUnsealed = new Set<number>()
const OWN_UNSEALED_MAX = 1000

// Sela o registro que acabou de ser gravado (e, de carona, os que este processo gravou antes e não conseguiu selar).
// Se falhar, os ids ficam guardados para a próxima tentativa — e a exceção sobe para quem chamou registrar o aviso.
export async function sealOwn(id: number): Promise<void> {
  ownUnsealed.add(id)
  if (ownUnsealed.size > OWN_UNSEALED_MAX) {
    // Falhando há muito tempo: guarda só os mais recentes (o Map/Set mantém a ordem de inserção).
    for (const antigo of [...ownUnsealed].slice(0, ownUnsealed.size - OWN_UNSEALED_MAX)) ownUnsealed.delete(antigo)
  }
  const ids = [...ownUnsealed]
  await sealPending({ ids })
  for (const selado of ids) ownUnsealed.delete(selado)
}

// Só para testes.
export function resetOwnUnsealed(): void {
  ownUnsealed.clear()
}

export interface IntegrityReport {
  integra: boolean
  // Registros com selo conferidos (do primeiro ao último selado).
  verificados: number
  // Registros ainda sem selo (gravados neste instante, por exemplo).
  naoSelados: number
  primeiroId: number | null
  ultimoId: number | null
  // Primeiro problema encontrado, se houver.
  quebra: { id: number; motivo: string } | null
}

const VERIFY_PAGE = 1000

// Confere a cadeia inteira, do primeiro ao último registro selado. Não sela nada (ver "quem sela o quê" acima).
export async function verifyAuditIntegrity(): Promise<IntegrityReport> {
  let verificados = 0
  let primeiroId: number | null = null
  let ultimoId: number | null = null
  let anterior: string | null = null
  let cursor = 0 // posição (selo_seq) do último registro conferido
  let quebra: IntegrityReport["quebra"] = null

  while (!quebra) {
    const rows = await prisma.auditLog.findMany({
      where: { selo: { not: null }, seloSeq: { gt: cursor } },
      orderBy: { seloSeq: "asc" },
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
      if (!safeEqual(row.selo, computeSeal(row.seloAnterior, row))) {
        quebra = { id: row.id, motivo: "O conteúdo deste registro não confere com o selo: foi alterado depois de gravado." }
        break
      }
      anterior = row.selo
      ultimoId = row.id
      verificados++
    }
    cursor = rows[rows.length - 1].seloSeq ?? cursor
  }

  // Registro com selo mas SEM posição na cadeia: a leitura acima anda por posição e o ignoraria — apagar só a
  // posição não pode servir para esconder um registro mexido.
  if (!quebra) {
    const semPosicao = await prisma.auditLog.findFirst({
      where: { selo: { not: null }, seloSeq: null },
      orderBy: { id: "asc" },
      select: { id: true },
    })
    if (semPosicao) {
      quebra = { id: semPosicao.id, motivo: "Este registro tem selo mas não tem posição na cadeia: foi mexido diretamente no banco." }
    }
  }

  // Registro sem selo há tempo demais: a selagem está falhando, ou mexeram no banco, ou é o histórico de uma instalação
  // anterior (o administrador precisa selar uma vez). Os mais novos podem estar sendo selados agora, então só contam
  // em `naoSelados`.
  if (!quebra) {
    const velho = await prisma.auditLog.findFirst({
      where: { selo: null, criadoEm: { lt: new Date(Date.now() - UNSEALED_TOLERANCE_MS) } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
    if (velho) {
      quebra = {
        id: velho.id,
        motivo: `Este registro está sem selo há mais de ${UNSEALED_TOLERANCE_MS / 60_000} minutos: a selagem está falhando ou o registro foi mexido diretamente no banco.`,
      }
    }
  }

  const naoSelados = await prisma.auditLog.count({ where: { selo: null } })
  return { integra: quebra === null, verificados, naoSelados, primeiroId, ultimoId, quebra }
}
