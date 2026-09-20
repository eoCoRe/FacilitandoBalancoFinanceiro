import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import type { Papel } from "@/lib/permissions"
import { logAuditSafe } from "./audit"
import { setSessionCookie, signSessionToken } from "./session"

// Passo final de todo login (senha direta ou senha + código): marca o último acesso, registra
// na auditoria e devolve a resposta com o cookie de sessão.
export async function issueSession(
  usuario: { id: number; nome: string; email: string; papel: Papel },
  detalhe: string,
): Promise<NextResponse> {
  await prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() } })
  await logAuditSafe("Login realizado", detalhe, usuario.email)

  const response = NextResponse.json({
    user: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
  })
  setSessionCookie(response, await signSessionToken(usuario.id))
  return response
}
