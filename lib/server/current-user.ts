import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import type { UserIdentity } from "@/lib/permissions"
import { SESSION_COOKIE, verifySessionToken } from "./session"

export type SessionUser = UserIdentity

// Quem está logado NESTA requisição, ou null. É a checagem "segura" (consulta o banco), ao
// contrário do proxy.ts, que só olha a assinatura do cookie. Separado de authz.ts para que
// os testes possam trocar só esta função e exercitar a regra de permissão de verdade.
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null

  const session = await verifySessionToken(token)
  if (!session) return null

  const usuario = await prisma.usuario.findUnique({ where: { id: session.userId } })
  if (!usuario || !usuario.ativo) return null
  // Senha trocada/redefinida depois da emissão do token: sessão antiga não vale mais.
  if (session.issuedAt < Math.floor(usuario.sessoesValidasDesde.getTime() / 1000)) return null

  return { id: usuario.id, email: usuario.email, nome: usuario.nome, papel: usuario.papel }
}
