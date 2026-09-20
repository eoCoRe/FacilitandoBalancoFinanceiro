import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/server/session"

// Checagem OTIMISTA de página: só confere a assinatura do cookie (sem banco), para mandar quem
// não está logado direto para /login e quem já está para fora dela. Não é a defesa dos dados —
// essa é a checagem "segura" de cada rota em /api (lib/server/authz.ts), que consulta o banco
// e confere perfil. Por isso /api fica fora do matcher: as rotas se protegem sozinhas.

// Páginas de quem ainda não tem sessão. Quem já está logado é mandado para fora de /login;
// as outras duas (recuperação de senha) ficam abertas para qualquer um, logado ou não.
const PUBLIC_PAGES = new Set(["/login", "/esqueci-senha", "/redefinir-senha"])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isLogin = pathname === "/login"
  const isPublic = PUBLIC_PAGES.has(pathname)

  let hasSession = false
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    hasSession = token ? (await verifySessionToken(token)) !== null : false
  } catch {
    // AUTH_SECRET ausente/curta: falha fechada e explícita, em vez de um erro 500 opaco.
    return new NextResponse("Servidor sem AUTH_SECRET configurada (mínimo 32 caracteres) — veja .env.example.", {
      status: 503,
    })
  }

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    return NextResponse.redirect(url)
  }
  if (hasSession && isLogin) {
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  // Páginas apenas: fora /api, arquivos internos do Next e qualquer arquivo com extensão (ícones, imagens).
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
}
