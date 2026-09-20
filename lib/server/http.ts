import { NextResponse } from "next/server"
import { ForbiddenError, ServiceUnavailableError, TooManyRequestsError, UnauthorizedError, ValidationError } from "./validation"

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
  throw error
}
