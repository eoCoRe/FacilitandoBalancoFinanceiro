import { NextResponse } from "next/server"
import {
  appOrigin,
  buildGoogleAuthUrl,
  googleConfig,
  googleRedirectUri,
  newOAuthFlow,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_MAX_AGE_SECONDS,
  signOAuthFlow,
} from "@/lib/server/auth/google"

// Primeiro passo do "Entrar com Google": guarda o estado do fluxo (state/PKCE/nonce) num
// cookie assinado de vida curta e manda o navegador para a tela de login do Google.
export async function GET(request: Request) {
  const config = googleConfig()
  if (!config) {
    return NextResponse.redirect(`${appOrigin(request)}/login?erro=google_indisponivel`)
  }

  const flow = newOAuthFlow()
  const response = NextResponse.redirect(
    buildGoogleAuthUrl({ clientId: config.clientId, redirectUri: googleRedirectUri(request), flow }),
  )
  response.cookies.set(OAUTH_COOKIE, await signOAuthFlow(flow), {
    httpOnly: true,
    sameSite: "lax", // precisa acompanhar o redirecionamento de volta do Google
    secure: process.env.NODE_ENV === "production",
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_MAX_AGE_SECONDS,
  })
  return response
}
