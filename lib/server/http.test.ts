import { describe, expect, it } from "vitest"
import { handleRouteError } from "./http"
import { UnauthorizedError, ValidationError } from "./validation"

describe("handleRouteError", () => {
  it("converte ValidationError em 400 com a mensagem do erro", async () => {
    const response = handleRouteError(new ValidationError("Nome é obrigatório."))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Nome é obrigatório." })
  })

  it("converte UnauthorizedError em 401 com a mensagem do erro", async () => {
    const response = handleRouteError(new UnauthorizedError("Token de acesso LGPD inválido."))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Token de acesso LGPD inválido." })
  })

  it("converte SyntaxError (JSON malformado) em 400", async () => {
    const response = handleRouteError(new SyntaxError("Unexpected token"))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/JSON malformado/i)
  })

  it("relança qualquer outro erro para o handler padrão do Next.js (500)", () => {
    expect(() => handleRouteError(new Error("falha inesperada"))).toThrow("falha inesperada")
  })

  it("relança mesmo quando o valor lançado não é uma instância de Error", () => {
    let caught: unknown
    try {
      handleRouteError("string qualquer")
    } catch (e) {
      caught = e
    }
    expect(caught).toBe("string qualquer")
  })
})
