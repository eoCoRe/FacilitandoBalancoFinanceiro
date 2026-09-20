import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { handleRouteError } from "@/lib/server/http"
import { isRateLimited, recordFailure } from "@/lib/server/rate-limit"
import {
  sendLoginCode,
  setTwoFactorCookie,
  signTwoFactorToken,
  TWO_FACTOR_CHALLENGE_KEY,
  TWO_FACTOR_CHALLENGE_MAX,
  TWO_FACTOR_COOKIE,
  verifyTwoFactorToken,
} from "@/lib/server/two-factor"
import { TooManyRequestsError, UnauthorizedError, ValidationError } from "@/lib/server/validation"

// "Não recebi o código": envia um novo (o anterior deixa de valer). Divide o mesmo limite de
// desafios por usuário do login, para o reenvio não virar uma forma de contornar o teto.
export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(TWO_FACTOR_COOKIE)?.value
    const pending = cookie ? await verifyTwoFactorToken(cookie) : null
    if (!pending) throw new UnauthorizedError("A verificação expirou. Entre novamente com a sua senha.")

    const usuario = await prisma.usuario.findUnique({ where: { id: pending.userId } })
    if (!usuario || !usuario.ativo) throw new UnauthorizedError("A verificação expirou. Entre novamente com a sua senha.")

    // Quem usa o app autenticador NÃO pode trocar para o código por e-mail: seria uma porta que dispensa
    // o segundo fator mais forte para quem só sabe a senha.
    if (usuario.totpAtivo) throw new ValidationError("A verificação usa o aplicativo autenticador; não há código para reenviar.")

    const challengeKey = TWO_FACTOR_CHALLENGE_KEY(usuario.id)
    if (isRateLimited(challengeKey, TWO_FACTOR_CHALLENGE_MAX)) {
      throw new TooManyRequestsError("Muitos códigos solicitados. Aguarde 15 minutos e tente novamente.")
    }
    recordFailure(challengeKey)

    const challengeId = await sendLoginCode(usuario)
    const response = NextResponse.json({ ok: true })
    setTwoFactorCookie(response, await signTwoFactorToken(usuario.id, challengeId))
    return response
  } catch (error) {
    return handleRouteError(error)
  }
}
