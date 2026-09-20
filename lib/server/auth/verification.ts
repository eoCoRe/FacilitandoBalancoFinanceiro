import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import type { TokenTipo } from "@prisma/client"
import { prisma } from "@/lib/db"
import { getAuthSecret } from "@/lib/server/auth/session"

// Links de recuperação de senha e códigos de 2 etapas (tabela token_verificacao). Regras que
// valem para os dois: uso único, validade curta, e o banco nunca guarda o segredo em si — se o
// banco vazar, não dá para reaproveitar um link nem um código.

export const RESET_TTL_MS = 30 * 60 * 1000
export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_CODE_ATTEMPTS = 5

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

// O código tem só 6 dígitos (1 milhão de combinações): um hash simples seria quebrado em
// segundos por quem lesse o banco. O HMAC com AUTH_SECRET exige também o segredo do servidor.
const hmac = (id: string, code: string) =>
  createHmac("sha256", Buffer.from(getAuthSecret())).update(`${id}:${code}`).digest("hex")

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

// ---- Link de recuperação de senha ----

// Devolve o token a enviar por e-mail: "<id>.<segredo>". Só o hash do segredo fica no banco.
// Um novo pedido invalida o anterior; tokens vencidos são limpos de passagem.
export async function createResetToken(usuarioId: number): Promise<string> {
  await prisma.tokenVerificacao.deleteMany({
    where: {
      OR: [
        { usuarioId, tipo: "RECUPERACAO_SENHA", usadoEm: null },
        { expiraEm: { lt: new Date() } },
      ],
    },
  })
  const id = randomBytes(16).toString("hex")
  const segredo = randomBytes(32).toString("base64url")
  await prisma.tokenVerificacao.create({
    data: {
      id,
      usuarioId,
      tipo: "RECUPERACAO_SENHA",
      segredoHash: sha256(segredo),
      expiraEm: new Date(Date.now() + RESET_TTL_MS),
    },
  })
  return `${id}.${segredo}`
}

// Confere e CONSOME o token (uso único, mesmo com duas requisições simultâneas). Devolve o id
// do usuário, ou null para qualquer problema (inexistente, adulterado, vencido, já usado) — quem
// chama não precisa, e não deve, distinguir o motivo.
export async function consumeResetToken(token: unknown): Promise<number | null> {
  if (typeof token !== "string") return null
  const [id, segredo, extra] = token.split(".")
  if (!id || !segredo || extra !== undefined) return null

  const row = await prisma.tokenVerificacao.findUnique({ where: { id } })
  if (!row || row.tipo !== "RECUPERACAO_SENHA" || row.usadoEm || row.expiraEm.getTime() <= Date.now()) return null
  if (!safeEqual(sha256(segredo), row.segredoHash)) return null

  const claimed = await prisma.tokenVerificacao.updateMany({
    where: { id, usadoEm: null },
    data: { usadoEm: new Date() },
  })
  return claimed.count === 1 ? row.usuarioId : null
}

// Devolve o link ao estado "não usado". Só para o caso de a gravação da nova senha falhar DEPOIS de
// o link ter sido gasto (falha de banco): a pessoa não deve ficar sem link por um erro que não foi dela.
export async function releaseResetToken(token: unknown): Promise<void> {
  if (typeof token !== "string") return
  const [id] = token.split(".")
  if (!id) return
  await prisma.tokenVerificacao.updateMany({ where: { id, tipo: "RECUPERACAO_SENHA" }, data: { usadoEm: null } })
}

// ---- Código de 6 dígitos (2 etapas no login e confirmação ao ligar o 2FA) ----

export type CodeTipo = Extract<TokenTipo, "LOGIN_2FA" | "ATIVACAO_2FA">

export async function createCodeChallenge(usuarioId: number, tipo: CodeTipo): Promise<{ id: string; code: string }> {
  // Um código novo invalida o anterior do mesmo tipo (o "reenviar" não deixa dois válidos).
  await prisma.tokenVerificacao.deleteMany({
    where: { OR: [{ usuarioId, tipo, usadoEm: null }, { expiraEm: { lt: new Date() } }] },
  })
  const id = randomBytes(16).toString("hex")
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0")
  await prisma.tokenVerificacao.create({
    data: { id, usuarioId, tipo, segredoHash: hmac(id, code), expiraEm: new Date(Date.now() + CODE_TTL_MS) },
  })
  return { id, code }
}

export type CodeCheck = "ok" | "invalido" | "expirado" | "bloqueado"

// Cada tentativa gasta UMA das 5 antes de comparar, de forma atômica no banco — assim chutes
// em paralelo não passam do limite. Sucesso também consome o código (uso único).
export async function checkCode(id: string, usuarioId: number, tipo: CodeTipo, rawCode: unknown): Promise<CodeCheck> {
  const code = typeof rawCode === "string" ? rawCode.replace(/\s+/g, "") : ""
  if (!/^\d{6}$/.test(code)) return "invalido"

  const claimed = await prisma.tokenVerificacao.updateMany({
    where: { id, usuarioId, tipo, usadoEm: null, expiraEm: { gt: new Date() }, tentativas: { lt: MAX_CODE_ATTEMPTS } },
    data: { tentativas: { increment: 1 } },
  })

  const row = await prisma.tokenVerificacao.findUnique({ where: { id } })
  if (claimed.count === 0) {
    if (!row || row.usuarioId !== usuarioId || row.tipo !== tipo || row.usadoEm) return "invalido"
    return row.expiraEm.getTime() <= Date.now() ? "expirado" : "bloqueado"
  }
  if (!row) return "invalido"

  if (!safeEqual(hmac(id, code), row.segredoHash)) {
    return row.tentativas >= MAX_CODE_ATTEMPTS ? "bloqueado" : "invalido"
  }
  const consumed = await prisma.tokenVerificacao.updateMany({
    where: { id, usadoEm: null },
    data: { usadoEm: new Date() },
  })
  return consumed.count === 1 ? "ok" : "invalido"
}

// Último código pendente do usuário (a confirmação do 2FA não tem cookie com o id do desafio).
export async function latestPendingChallengeId(usuarioId: number, tipo: CodeTipo): Promise<string | null> {
  const row = await prisma.tokenVerificacao.findFirst({
    where: { usuarioId, tipo, usadoEm: null, expiraEm: { gt: new Date() } },
    orderBy: { criadoEm: "desc" },
  })
  return row?.id ?? null
}
