import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit"
import { requireUser } from "@/lib/server/authz"
import { handleRouteError } from "@/lib/server/http"
import { setSessionCookie, signSessionToken } from "@/lib/server/session"

// "Sair dos outros dispositivos": encerra TODAS as sessões abertas da conta, menos a desta requisição (o cookie
// dela é reemitido logo em seguida). Útil quando o usuário esqueceu o sistema aberto em outro computador ou
// suspeita que alguém copiou o cookie. Usa o mesmo mecanismo da troca de senha (sessoes_validas_desde).
export async function POST() {
  try {
    const user = await requireUser()
    await prisma.usuario.update({ where: { id: user.id }, data: { sessoesValidasDesde: new Date() } })
    await logAuditSafe("Outras sessões encerradas", "O próprio usuário encerrou as sessões abertas em outros dispositivos.", user.email)

    const response = NextResponse.json({ ok: true })
    setSessionCookie(response, await signSessionToken(user.id))
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
