import { createHmac } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { safeEqual } from "@/lib/server/auth/safe-equal"
import { getAuthSecret } from "@/lib/server/auth/session"
import { logEvent } from "@/lib/server/log"

// Integridade da trilha de auditoria (RNF03). Cada registro recebe um selo: HMAC-SHA256 dos seus campos, da sua posição
// na cadeia (selo_seq) e do selo do registro anterior. Assim:
//  - editar qualquer campo — ou a posição — de um registro selado muda o selo dele → a verificação aponta o registro;
//  - apagar (ou inserir) um registro no meio quebra o encadeamento no registro seguinte;
//  - quem só tem acesso ao banco não consegue refazer os selos, porque a chave (AUDIT_SEAL_SECRET, ou
//    AUTH_SECRET se ela não existir) não está no banco.
//
// QUEM SELA O QUÊ. O servidor só sela os registros que ELE MESMO acabou de gravar, e só se o conteúdo ainda for o que ele
// gravou (guarda na memória do processo uma impressão do conteúdo, por id, até a selagem dar certo). Nada de "selar tudo
// que está sem selo": isso deixaria quem tem só o banco zerar os selos, editar os registros e fazer o próprio servidor
// carimbar o resultado — e nenhum critério guardado no banco (como a data do registro) serve para distinguir, porque quem
// escreve no banco também escreve nele. Registro sem selo que o servidor não gravou agora é PROBLEMA a apontar; quem decide
// selar um registro assim é o ADMINISTRADOR, por uma ação explícita que fica na trilha (POST /api/auditoria/selar-pendentes)
// — a recuperação de uma falha de selagem depois de reiniciar o processo, ou o histórico de uma instalação anterior à
// selagem (uma vez).
//
// UMA CADEIA POR EMPRESA. Cada registro encadeia no último selo da PRÓPRIA empresa, e a posição (selo_seq) conta dentro
// dela. Assim a eliminação LGPD de uma empresa (que apaga os registros dela, em cascata) leva a cadeia dela inteira e não
// abre um buraco no meio da cadeia das outras. Com uma empresa só, é a mesma cadeia de antes.
//
// Limites assumidos (também em SECURITY.md): apagar os registros mais RECENTES não é detectável sem uma âncora externa; o
// expurgo por retenção só apaga o começo de cada cadeia (ver retention.ts) e a verificação recomeça do primeiro que sobrou.

// Trava que serializa a selagem (e o expurgo) entre requisições simultâneas: dois selando ao mesmo tempo bifurcariam a cadeia.
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
// selo_seq é um Int4 do Postgres: perto do limite a selagem para com um erro claro, em vez de estourar no meio.
const SEQ_LIMIT = 2_000_000_000

type Fields = { id: number; empresaId: number; usuario: string; acao: string; detalhe: string; criadoEm: Date }
type SealedRow = Fields & { selo: string | null; seloAnterior: string | null; seloSeq: number | null }

function sealKey(): Buffer {
  const dedicated = process.env.AUDIT_SEAL_SECRET
  if (dedicated) {
    if (dedicated.length < 32) throw new Error("AUDIT_SEAL_SECRET deve ter pelo menos 32 caracteres.")
    return Buffer.from(dedicated)
  }
  return Buffer.from(getAuthSecret())
}

const hmac = (domain: string, parts: unknown[]) => createHmac("sha256", sealKey()).update(`${domain}:${JSON.stringify(parts)}`).digest("hex")

// O selo cobre os campos, a POSIÇÃO na cadeia (seq) e o selo anterior.
export function computeSeal(previousSeal: string | null, seq: number, row: Fields): string {
  return hmac("auditoria:v2", [previousSeal ?? "", seq, row.id, row.empresaId, row.criadoEm.toISOString(), row.usuario, row.acao, row.detalhe])
}

// Impressão do CONTEÚDO como foi gravado (sem posição nem selo anterior): o servidor guarda esta impressão em memória e
// só sela o registro se, na hora de selar, o conteúdo no banco ainda bater com ela.
export function contentFingerprint(row: Fields): string {
  return hmac("auditoria:conteudo:v1", [row.id, row.empresaId, row.criadoEm.toISOString(), row.usuario, row.acao, row.detalhe])
}

export interface SealResult {
  count: number
  primeiroId: number | null
  ultimoId: number | null
}

// Sela registros ainda sem selo. A cadeia segue a ORDEM EM QUE OS SELOS SÃO GERADOS (selo_seq), não o id: se um registro
// de id menor só for confirmado depois de outro mais novo já selado (duas requisições simultâneas), ele entra no fim da
// cadeia — nunca fica sem selo.
//  - `ids`: só estes registros (o caminho normal: o que este processo acabou de gravar). Com `expected` (id → impressão do
//    conteúdo gravado), um registro cujo conteúdo mudou desde a gravação NÃO é selado;
//  - `all`: TODOS os que estão sem selo (só a ação explícita do administrador, que fica registrada na trilha); com
//    `empresaId`, só os dessa empresa.
// Antes de encadear numa cadeia, confere o selo do ÚLTIMO registro dela: se ele foi mexido, a selagem é suspensa (erro)
// em vez de se apoiar num elo adulterado.
export async function sealPendingDetailed({
  ids,
  all = false,
  expected,
  empresaId,
}: {
  ids?: readonly number[]
  all?: boolean
  expected?: ReadonlyMap<number, string>
  empresaId?: number
} = {}): Promise<SealResult> {
  const result: SealResult = { count: 0, primeiroId: null, ultimoId: null }
  if (!all && (!ids || ids.length === 0)) return result

  for (let batch = 0; batch < SEAL_MAX_BATCHES; batch++) {
    const lote = await prisma.$transaction(async (tx) => {
      // ::text porque o retorno da função é "void", que o driver não sabe ler. Uma trava só para todas as empresas:
      // mais simples, e a selagem é rápida.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SEAL_LOCK_KEY})::text`
      const pending = await tx.auditLog.findMany({
        where: {
          selo: null,
          ...(empresaId === undefined ? {} : { empresaId }),
          ...(all ? {} : { id: { in: [...(ids ?? [])] } }),
        },
        orderBy: { id: "asc" },
        take: SEAL_BATCH,
      })
      // Ponta de cada cadeia tocada neste lote (empresa → último selo e posição).
      const pontas = new Map<number, { previous: string | null; seq: number }>()
      const selados: number[] = []
      for (const row of pending) {
        const esperado = expected?.get(row.id)
        if (esperado !== undefined && !safeEqual(contentFingerprint(row), esperado)) {
          // O conteúdo mudou entre a gravação e a selagem: o servidor não vira testemunha de algo que não gravou.
          logEvent("error", "audit.seal.content_mismatch", { id: row.id })
          continue
        }
        let ponta = pontas.get(row.empresaId)
        if (!ponta) {
          // Só posições preenchidas: no Postgres, ORDER BY ... DESC põe NULL primeiro, e um registro com selo mas sem
          // posição viraria o "último" e bagunçaria a cadeia.
          const last = await tx.auditLog.findFirst({
            where: { empresaId: row.empresaId, selo: { not: null }, seloSeq: { not: null } },
            orderBy: { seloSeq: "desc" },
          })
          if (last && !safeEqual(last.selo, computeSeal(last.seloAnterior, last.seloSeq as number, last))) {
            throw new Error("O último registro selado da auditoria não confere com o selo (a cadeia foi alterada): a selagem foi suspensa. Verifique a integridade.")
          }
          ponta = { previous: last?.selo ?? null, seq: last?.seloSeq ?? 0 }
          pontas.set(row.empresaId, ponta)
        }
        if (ponta.seq + 1 > SEQ_LIMIT) throw new Error("selo_seq chegou perto do limite do Int4: a selagem foi suspensa.")
        ponta.seq += 1
        const selo = computeSeal(ponta.previous, ponta.seq, row)
        await tx.auditLog.update({ where: { id: row.id }, data: { selo, seloAnterior: ponta.previous, seloSeq: ponta.seq } })
        ponta.previous = selo
        selados.push(row.id)
      }
      return { lidos: pending.length, selados }
    }, SEAL_TX_OPTIONS)

    result.count += lote.selados.length
    for (const id of lote.selados) {
      result.primeiroId = result.primeiroId === null ? id : Math.min(result.primeiroId, id)
      result.ultimoId = result.ultimoId === null ? id : Math.max(result.ultimoId, id)
    }
    if (lote.lidos < SEAL_BATCH) break
    // `ids` com muitos registros que não foram selados (conteúdo mudou) poderia repetir o mesmo lote: para aqui.
    if (!all && lote.selados.length === 0) break
  }
  return result
}

export async function sealPending(options: Parameters<typeof sealPendingDetailed>[0] = {}): Promise<number> {
  return (await sealPendingDetailed(options)).count
}

// Registros que ESTE processo gravou e ainda não conseguiu selar, com a impressão do conteúdo gravado. Vive na memória do
// processo de propósito: é a única prova de "fui eu que gravei, e era isto" que quem só tem acesso ao banco não forja.
const ownUnsealed = new Map<number, string>()
const OWN_UNSEALED_MAX = 1000

async function sealOwnPending(): Promise<void> {
  const ids = [...ownUnsealed.keys()]
  await sealPending({ ids, expected: ownUnsealed })
  // Selados — ou recusados por conteúdo alterado (já registrado no log): em ambos os casos não há o que repetir.
  for (const id of ids) ownUnsealed.delete(id)
}

// Sela o registro que acabou de ser gravado (e, de carona, os que este processo gravou antes e não conseguiu selar).
// Se falhar, ficam guardados para a próxima tentativa — e a exceção sobe para quem chamou registrar o aviso.
export async function sealOwn(row: Fields): Promise<void> {
  ownUnsealed.set(row.id, contentFingerprint(row))
  if (ownUnsealed.size > OWN_UNSEALED_MAX) {
    // Falhando há muito tempo: guarda só os mais recentes (o Map mantém a ordem de inserção).
    for (const antigo of [...ownUnsealed.keys()].slice(0, ownUnsealed.size - OWN_UNSEALED_MAX)) ownUnsealed.delete(antigo)
  }
  await sealOwnPending()
}

// Tenta de novo selar o que ESTE processo gravou e não conseguiu selar (uma falha passageira do banco). É seguro: só mexe
// em registros que este processo mesmo gravou, e só se o conteúdo não mudou. A verificação chama isto antes de conferir,
// para uma falha passageira não virar um falso alarme de adulteração.
export async function retryOwnUnsealed(): Promise<void> {
  if (ownUnsealed.size === 0) return
  await sealOwnPending()
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

// Confere a cadeia inteira DA EMPRESA, do primeiro ao último registro selado. Não sela nada de ninguém (ver "quem sela o
// quê" acima); só repete a selagem do que ESTE processo gravou e não conseguiu selar.
export async function verifyAuditIntegrity({ empresaId, settleMs = SETTLE_MS }: { empresaId: number; settleMs?: number }): Promise<IntegrityReport> {
  await retryOwnUnsealed().catch(() => {}) // se ainda falhar, o registro aparece como sem selo, que é a verdade

  let verificados = 0
  let primeiroId: number | null = null
  let ultimoId: number | null = null
  let quebra: IntegrityReport["quebra"] = null

  // A cadeia é lida de um INSTANTÂNEO (REPEATABLE READ): um expurgo que rode no meio da leitura por páginas não pode
  // fazer as páginas seguintes começarem depois de um trecho que sumiu (o que pareceria adulteração).
  await prisma.$transaction(
    async (tx) => {
      let anterior: string | null = null
      let cursor: number | null = null // posição (selo_seq) do último registro conferido; null = primeira página

      while (!quebra) {
        const rows: SealedRow[] = await tx.auditLog.findMany({
          where: { empresaId, selo: { not: null }, seloSeq: cursor === null ? { not: null } : { gt: cursor } },
          orderBy: { seloSeq: "asc" },
          take: VERIFY_PAGE,
        })
        if (rows.length === 0) break

        for (const row of rows) {
          const seq = row.seloSeq as number
          if (primeiroId === null) {
            primeiroId = row.id
            // O primeiro registro que sobrou é a âncora: o selo anterior dele é aceito como está (o anterior pode
            // ter sido expurgado por retenção), mas o selo do próprio registro é conferido.
          } else if (row.seloAnterior !== anterior) {
            quebra = { id: row.id, tipo: "encadeamento", motivo: "O encadeamento com o registro anterior não confere: há registro apagado ou inserido antes deste." }
            break
          }
          if (!safeEqual(row.selo, computeSeal(row.seloAnterior, seq, row))) {
            quebra = { id: row.id, tipo: "conteudo", motivo: "O conteúdo (ou a posição) deste registro não confere com o selo: foi alterado depois de gravado." }
            break
          }
          anterior = row.selo
          ultimoId = row.id
          verificados++
        }
        cursor = rows[rows.length - 1].seloSeq
      }

      if (quebra) return

      // Registro com selo mas SEM posição na cadeia: a leitura acima anda por posição e o ignoraria — apagar só a
      // posição não pode servir para esconder um registro mexido.
      const semPosicao = await tx.auditLog.findFirst({
        where: { empresaId, selo: { not: null }, seloSeq: null },
        orderBy: { id: "asc" },
        select: { id: true },
      })
      if (semPosicao) {
        quebra = { id: semPosicao.id, tipo: "posicao", motivo: "Este registro tem selo mas não tem posição na cadeia: foi mexido diretamente no banco." }
        return
      }
      // Posição repetida: a leitura por "maior que a última" pularia o segundo registro. Se a contagem de selados não
      // bate com a de conferidos, sobrou registro fora da cadeia.
      const totalSelados = await tx.auditLog.count({ where: { empresaId, selo: { not: null } } })
      if (totalSelados !== verificados) {
        quebra = { id: ultimoId ?? 0, tipo: "posicao", motivo: "Há registros selados que não entram na cadeia (posição repetida ou fora do intervalo): foi mexido diretamente no banco." }
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000, maxWait: 10_000 },
  )

  // Registro que continua SEM selo: a selagem falhou (e o processo reiniciou), ou é o histórico de uma instalação
  // anterior (o administrador sela uma vez), ou mexeram no banco. Um registro que acabou de ser gravado por outro
  // servidor pode estar sendo selado neste instante, por isso se espera um pouco e se olha de novo — sem usar a data do
  // registro, que não é confiável (quem escreve no banco reescreve a data). Fora do instantâneo: precisa enxergar o que
  // foi selado durante a espera.
  if (!quebra) {
    const primeiroSemSelo = () => prisma.auditLog.findFirst({ where: { empresaId, selo: null }, orderBy: { id: "asc" }, select: { id: true } })
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

  const naoSelados = await prisma.auditLog.count({ where: { empresaId, selo: null } })
  return { integra: quebra === null, verificados, naoSelados, primeiroId, ultimoId, quebra }
}
