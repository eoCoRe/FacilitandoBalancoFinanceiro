import { NextResponse, type NextRequest } from "next/server"
import { isCrossOriginMutation } from "@/lib/server/auth/csrf"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/server/auth/session"

// Checagem OTIMISTA de página: só confere a assinatura do cookie (sem banco), para mandar quem
// não está logado direto para /login e quem já está para fora dela. Não é a defesa dos dados —
// essa é a checagem "segura" de cada rota em /api (lib/server/auth/authz.ts), que consulta o banco
// e confere perfil. Por isso, em /api, o proxy NÃO olha a sessão: só recusa mutação vinda de outra origem
// (CSRF, ver lib/server/auth/csrf.ts); quem decide o acesso são as próprias rotas.

// Páginas de quem ainda não tem sessão. Quem já está logado é mandado para fora de /login;
// as outras duas (recuperação de senha) ficam abertas para qualquer um, logado ou não.
const PUBLIC_PAGES = new Set(["/login", "/esqueci-senha", "/redefinir-senha"])

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith("/api/")) {
    if (isCrossOriginMutation(request.method, request.headers, pathname)) {
      return NextResponse.json(
        { error: "Requisição de outra origem recusada." },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      )
    }
    return NextResponse.next()
  }

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
  // /api (só a checagem de origem) e as páginas — fora arquivos internos do Next e qualquer arquivo com
  // extensão (ícones, imagens).
  matcher: ["/api/:path*", "/((?!api|_next/static|_next/image|.*\\..*).*)"],
}
