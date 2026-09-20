import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import type { UserIdentity } from "@/lib/permissions"
import {
  SESSION_ABSOLUTE_MAX_SECONDS,
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_SECONDS,
  sessionCookieOptions,
  signSessionToken,
  verifySessionToken,
} from "./session"

export type SessionUser = UserIdentity

// Quem está logado NESTA requisição, ou null. É a checagem "segura" (consulta o banco), ao
// contrário do proxy.ts, que só olha a assinatura do cookie. Separado de authz.ts para que
// os testes possam trocar só esta função e exercitar a regra de permissão de verdade.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await verifySessionToken(token)
  if (!session) return null

  const agora = Math.floor(Date.now() / 1000)
  // Teto absoluto desde o login de verdade: a renovação deslizante não pode esticar a sessão para sempre.
  if (agora - session.authTime > SESSION_ABSOLUTE_MAX_SECONDS) return null

  const usuario = await prisma.usuario.findUnique({ where: { id: session.userId } })
  if (!usuario || !usuario.ativo) return null
  // Senha trocada/redefinida ou "encerrar outras sessões" depois da emissão do token: sessão antiga não vale mais.
  if (session.issuedAt < Math.floor(usuario.sessoesValidasDesde.getTime() / 1000)) return null

  // Renovação deslizante: passou metade da vida do token, reemite o cookie (mesmo login original).
  if (agora - session.issuedAt > SESSION_RENEW_AFTER_SECONDS) {
    try {
      cookieStore.set(SESSION_COOKIE, await signSessionToken(usuario.id, session.authTime), sessionCookieOptions())
    } catch {
      // Contexto em que não se pode escrever cookie (ex.: renderização de servidor): a sessão segue valendo até
      // o token atual expirar e a renovação acontece na próxima chamada de API.
    }
  }

  return { id: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel }
}
