import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { logAuditSafe } from "@/lib/server/audit/audit"
import { requireUser } from "@/lib/server/auth/authz"
import { handleRouteError } from "@/lib/server/http"
import { SESSION_COOKIE, setSessionCookie, signSessionToken, verifySessionToken } from "@/lib/server/auth/session"

// "Sair dos outros dispositivos": encerra TODAS as sessões abertas da conta, menos a desta requisição (o cookie
// dela é reemitido logo em seguida). Útil quando o usuário esqueceu o sistema aberto em outro computador ou
// suspeita que alguém copiou o cookie. Usa o mesmo mecanismo da troca de senha (sessoes_validas_desde).
export async function POST() {
  try {
    const user = await requireUser()
    await prisma.usuario.update({ where: { id: user.id }, data: { sessoesValidasDesde: new Date() } })
    await logAuditSafe("Outras sessões encerradas", "O próprio usuário encerrou as sessões abertas em outros dispositivos.", user.email)

    // O cookie reemitido MANTÉM o momento do login original: reemitir "como novo" deixaria uma sessão esquecida ou
    // roubada se renovar sozinha para sempre, contornando o teto de 24 h (só quem prova a senha reinicia o relógio).
    let authTime: number | undefined
    try {
      const token = (await cookies()).get(SESSION_COOKIE)?.value
      authTime = token ? (await verifySessionToken(token))?.authTime : undefined
    } catch {
      // sem contexto de requisição para ler o cookie (só acontece fora do servidor, em testes)
    }

    const response = NextResponse.json({ ok: true })
    setSessionCookie(response, await signSessionToken(user.id, authTime))
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
