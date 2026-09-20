// Cliente HTTP mínimo para as rotas de /api. Erros viram ApiError com uma mensagem já pronta
// para o usuário (as rotas devolvem `{ error }` em 400/401; o resto vira texto genérico).

export class ApiError extends Error {}

// Sessão expirada, conta desativada ou cookie inválido: limpa o cookie ANTES de ir para /login.
// Sem isso o proxy (que só confere a assinatura) veria um cookie ainda "válido" e devolveria o
// usuário para a página inicial, que tomaria 401 de novo, em loop.
async function endSession(): Promise<void> {
  if (typeof window === "undefined") return
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
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === "string" && body.error) message = body.error
    } catch {
      // corpo não-JSON (ex.: página de erro do Next) — mantém a mensagem genérica.
    }
    throw new ApiError(message)
  }

  return (await response.json()) as T
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado."
}
