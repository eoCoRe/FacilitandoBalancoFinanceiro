import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { describeError, logEvent } from "@/lib/server/log"
import {
  appOrigin,
  exchangeCodeForIdToken,
  googleConfig,
  googleRedirectUri,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  verifyGoogleIdToken,
  verifyOAuthFlow,
} from "@/lib/server/auth/google"
import { issueSession } from "@/lib/server/auth/login-session"

// Todo desfecho é um redirecionamento (a tela de login mostra o motivo pelo código `erro`);
// o corpo da falha nunca vaza para a URL.
function failure(request: Request, code: string): NextResponse {
  const response = NextResponse.redirect(`${appOrigin(request)}/login?erro=${code}`)
  response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 })
  return response
}

// Segundo passo: o Google devolve o navegador aqui com `code` e `state`.
export async function GET(request: NextRequest) {
  const config = googleConfig()
  if (!config) return failure(request, "google_indisponivel")

  const params = request.nextUrl.searchParams
  if (params.get("error")) return failure(request, "google_negado")

  const code = params.get("code")
  const state = params.get("state")
  const cookie = request.cookies.get(OAUTH_COOKIE)?.value
  const flow = cookie ? await verifyOAuthFlow(cookie) : null
  // state ausente/diferente = a resposta não veio do login que ESTE navegador iniciou.
  if (!code || !state || !flow || flow.state !== state) return failure(request, "google_falhou")

  let profile
  try {
    const idToken = await exchangeCodeForIdToken({
      code,
      verifier: flow.verifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: googleRedirectUri(request),
    })
    profile = await verifyGoogleIdToken(idToken, config.clientId, flow.nonce)
  } catch (error) {
    logEvent("error", "auth.google.failed", describeError(error))
    return failure(request, "google_falhou")
  }

  // Um e-mail não verificado pelo Google não prova que a pessoa é dona dele.
  if (!profile.emailVerified) return failure(request, "google_email_nao_verificado")

  const usuario =
    (await prisma.usuario.findUnique({ where: { googleSub: profile.sub } })) ??
    (await prisma.usuario.findUnique({ where: { email: profile.email } }))

  // Sem auto-cadastro: quem não foi cadastrado por um administrador não entra.
  if (!usuario) return failure(request, "google_sem_cadastro")
  if (!usuario.ativo) return failure(request, "conta_inativa")
  // Mesmo e-mail, mas já vinculado a OUTRA conta Google: não sobrescreve o vínculo.
  if (usuario.googleSub && usuario.googleSub !== profile.sub) return failure(request, "google_falhou")

  const response = await issueSession(usuario, "Entrada com conta Google.", {
    response: NextResponse.redirect(`${appOrigin(request)}/`),
    data: { googleSub: profile.sub },
  })
  response.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_COOKIE_PATH, maxAge: 0 })
  return response
}
