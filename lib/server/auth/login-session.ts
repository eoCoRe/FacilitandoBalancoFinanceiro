import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { UserIdentity } from "@/lib/permissions"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { setSessionCookie, signSessionToken } from "@/lib/server/auth/session"

interface IssueSessionOptions {
  // Resposta a que o cookie será anexado. Padrão: JSON com o usuário (login por API); o login do
  // Google passa um redirecionamento.
  response?: NextResponse
  // Campos extras gravados no mesmo update do "último acesso" (ex.: googleSub no primeiro login Google).
  data?: { googleSub?: string }
}

// Passo final de todo login (senha direta, senha + código ou Google): marca o último acesso,
// registra na auditoria e devolve a resposta com o cookie de sessão.
export async function issueSession(
  usuario: UserIdentity,
  detalhe: string,
  options: IssueSessionOptions = {},
): Promise<NextResponse> {
  await prisma.usuario.update({ where: { id: usuario.id }, data: { ...options.data, ultimoLoginEm: new Date() } })
  await logAuditSafe("Login realizado", detalhe, usuario.email)

  const response =
    options.response ??
    NextResponse.json({ user: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel } })
  setSessionCookie(response, await signSessionToken(usuario.id))
  return response
}
