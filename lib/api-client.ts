// Cliente HTTP mínimo para as rotas de /api. Erros viram ApiError com uma mensagem já pronta
// para o usuário (as rotas devolvem `{ error }` em 400/401; o resto vira texto genérico).

export class ApiError extends Error {
  // Código de máquina que o servidor manda junto (ex.: "SEM_EMPRESA"), para a tela reagir sem ler a mensagem.
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

// Sessão expirada, conta desativada ou cookie inválido: limpa o cookie ANTES de ir para /login.
// Sem isso o proxy (que só confere a assinatura) veria um cookie ainda "válido" e devolveria o
// usuário para a página inicial, que tomaria 401 de novo, em loop.
// Várias chamadas em paralelo podem tomar 401 ao mesmo tempo; só a primeira encerra a sessão.
let ending = false

async function endSession(): Promise<void> {
  if (typeof window === "undefined" || ending) return
  ending = true
  try {
    await fetch("/api/auth/logout", { method: "POST" })
  } catch {
    // sem rede: vai para o login do mesmo jeito.
  }
  // Navegação completa de propósito: descarta o estado em memória (dados do usuário anterior).
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login")
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean; redirectOn401?: boolean } = {},
): Promise<T> {
  // Já está indo para o login: não adianta disparar mais requisições que só vão tomar 401.
  if (ending) throw new ApiError("Sua sessão expirou. Faça login novamente.")

  let response: Response
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      // Permite que uma edição pendente termine mesmo se a aba for fechada logo em seguida.
      keepalive: init.keepalive,
    })
  } catch {
    throw new ApiError("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.")
  }

  if (!response.ok) {
    if (response.status === 401 && init.redirectOn401 !== false) {
      await endSession()
      throw new ApiError("Sua sessão expirou. Faça login novamente.")
    }
    let message = `O servidor respondeu com erro (${response.status}).`
    let code: string | undefined
    try {
      const body = (await response.json()) as { error?: unknown; codigo?: unknown }
      if (typeof body.error === "string" && body.error) message = body.error
      if (typeof body.codigo === "string") code = body.codigo
    } catch {
      // corpo não-JSON (ex.: página de erro do Next) — mantém a mensagem genérica.
    }
    throw new ApiError(message, code)
  }

  return (await response.json()) as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado."
}
