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
export const SEAL_LOCK_KEY = 7_310_442
const SEAL_BATCH = 100
// Cada lote é uma transação interativa (padrão do Prisma: 5 s). O tempo folgado evita que um banco lento ou remoto
// aborte o lote no meio e o refaça para sempre; a trava só é mantida enquanto o lote roda.
const SEAL_TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 }
// Limite de lotes por chamada: quem grava um evento não deve ficar preso selando um histórico enorme.
const SEAL_MAX_BATCHES = 25
// Quantos registros no máximo UMA chamada de sealPending consegue selar (lotes × tamanho do lote).
export const SEAL_MAX_PER_CALL = SEAL_BATCH * SEAL_MAX_BATCHES
// Na VERIFICAÇÃO, um registro sem selo pode estar sendo selado agora (pelo servidor que o gravou, milissegundos depois do
// `create`). Em vez de confiar na data do registro — que quem escreve no banco também escreve — a verificação ESPERA um
// instante e olha de novo: quem ainda está sem selo depois disso não está "em andamento".
export const SETTLE_MS = 1500

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

// Tenta de novo selar o que ESTE processo gravou e não conseguiu selar (uma falha passageira do banco). É seguro: só
// mexe em registros que este processo mesmo gravou. A verificação chama isto antes de conferir, para uma falha
// passageira não virar um falso alarme de adulteração.
export async function retryOwnUnsealed(): Promise<void> {
  if (ownUnsealed.size === 0) return
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
  // Registros ainda sem selo. Só é "problema" (quebra) se continuarem assim depois de a verificação esperar um instante.
  naoSelados: number
  primeiroId: number | null
  ultimoId: number | null
  // Primeiro problema encontrado, se houver. `tipo` deixa a tela decidir o que oferecer sem depender do texto da mensagem
  // (só "sem-selo" é algo que o administrador pode resolver selando à mão).
  quebra: { id: number; motivo: string; tipo: "conteudo" | "encadeamento" | "posicao" | "sem-selo" } | null
}

const VERIFY_PAGE = 1000

// Confere a cadeia inteira, do primeiro ao último registro selado. Não sela nada de ninguém (ver "quem sela o quê"
// acima); só repete a selagem do que ESTE processo gravou e não conseguiu selar.
export async function verifyAuditIntegrity({ settleMs = SETTLE_MS }: { settleMs?: number } = {}): Promise<IntegrityReport> {
  await retryOwnUnsealed().catch(() => {}) // se ainda falhar, o registro aparece como sem selo, que é a verdade

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
        quebra = { id: row.id, tipo: "encadeamento", motivo: "O encadeamento com o registro anterior não confere: há registro apagado ou inserido antes deste." }
        break
      }
      if (!safeEqual(row.selo, computeSeal(row.seloAnterior, row))) {
        quebra = { id: row.id, tipo: "conteudo", motivo: "O conteúdo deste registro não confere com o selo: foi alterado depois de gravado." }
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
      quebra = { id: semPosicao.id, tipo: "posicao", motivo: "Este registro tem selo mas não tem posição na cadeia: foi mexido diretamente no banco." }
    }
  }

  // Registro que continua SEM selo: a selagem falhou (e o processo reiniciou), ou é o histórico de uma instalação
  // anterior (o administrador sela uma vez), ou mexeram no banco. Um registro que acabou de ser gravado por outro
  // servidor pode estar sendo selado neste instante, por isso se espera um pouco e se olha de novo — sem usar a data do
  // registro, que não é confiável (quem escreve no banco reescreve a data).
  if (!quebra) {
    const primeiroSemSelo = () =>
      prisma.auditLog.findFirst({ where: { selo: null }, orderBy: { id: "asc" }, select: { id: true } })
    if (await primeiroSemSelo()) {
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs))
      const semSelo = await primeiroSemSelo()
      if (semSelo) {
        quebra = {
          id: semSelo.id,
          tipo: "sem-selo",
          motivo: "Este registro está sem selo: a selagem falhou, é anterior ao recurso, ou o registro foi mexido diretamente no banco.",
        }
      }
    }
  }

  const naoSelados = await prisma.auditLog.count({ where: { selo: null } })
  return { integra: quebra === null, verificados, naoSelados, primeiroId, ultimoId, quebra }
}
