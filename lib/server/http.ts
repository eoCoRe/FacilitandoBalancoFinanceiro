import { NextResponse } from "next/server"
import { describeError, logEvent } from "@/lib/server/log"
import { ForbiddenError, NoCompanyError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError, ValidationError } from "@/lib/server/validation"

// Converte ValidationError em 400 com a mensagem já pronta para o cliente. JSON
// malformado no corpo (SyntaxError de `request.json()`) também é entrada inválida do
// cliente, não bug do servidor — mesmo tratamento. UnauthorizedError (sem login ou
// credencial inválida) vira 401, ForbiddenError (perfil sem permissão) 403 e
// TooManyRequestsError (limite de tentativas de login) 429. Qualquer outro erro sobe para o handler de erro padrão do
// Next.js (500).
export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof NoCompanyError) {
    return NextResponse.json({ error: error.message, codigo: "SEM_EMPRESA" }, { status: 409 })
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof TooManyRequestsError) {
    return NextResponse.json({ error: error.message }, { status: 429 })
  }
  if (error instanceof ServiceUnavailableError) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Corpo da requisição inválido (JSON malformado)." }, { status: 400 })
  }
  // Erro inesperado (bug, banco fora...): fica no log estruturado só com nome e código — a mensagem pode
  // conter valores de consulta — e segue para o tratamento padrão do Next (500).
  logEvent("error", "http.unhandled_error", describeError(error))
  throw error
}
