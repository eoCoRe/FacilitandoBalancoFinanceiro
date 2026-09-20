import { NextResponse } from "next/server"
import { clearSessionCookie } from "@/lib/server/auth/session"

// Encerra a sessão neste navegador. Idempotente e sem exigir login: sair já estando fora não
// é erro. (O token em si continua "válido" até expirar se alguém o tiver copiado; para
// derrubar todas as sessões de alguém, troque a senha — ver /api/auth/senha.)
export async function POST() {
  const response = NextResponse.json({ ok: true })
  clearSessionCookie(response)
  return response
}
