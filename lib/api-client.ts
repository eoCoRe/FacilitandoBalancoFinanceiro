// Cliente HTTP mínimo para as rotas de /api. Erros viram ApiError com uma mensagem já pronta
// para o usuário (as rotas devolvem `{ error }` em 400/401; o resto vira texto genérico).

export class ApiError extends Error {}

export async function api<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
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
