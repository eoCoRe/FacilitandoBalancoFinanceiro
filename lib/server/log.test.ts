import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { describeError, logEvent, maskEmail, redactFields } from "./log"

describe("maskEmail", () => {
  it("mantém a 1ª letra e o domínio", () => {
    expect(maskEmail("ana@teste.com")).toBe("a**@teste.com")
    expect(maskEmail("lucaswwwarmling@gmail.com")).toBe("l**************@gmail.com")
  })
  it("valor que não é e-mail vira ***", () => {
    expect(maskEmail("sem-arroba")).toBe("***")
  })
})

describe("redactFields", () => {
  it("apaga qualquer campo com nome de segredo, mesmo passado por engano", () => {
    const out = redactFields({
      senha: "abc",
      novaSenha: "abc",
      token: "t",
      codigo: "123456",
      code: "1",
      cookie: "c",
      Authorization: "Bearer x",
      senhaHash: "scrypt$..",
      AUTH_SECRET: "s",
      ok: "visível",
    })
    for (const k of ["senha", "novaSenha", "token", "codigo", "code", "cookie", "Authorization", "senhaHash", "AUTH_SECRET"]) {
      expect(out[k], k).toBe("[oculto]")
    }
    expect(out.ok).toBe("visível")
  })

  it("não confunde campos inofensivos que só CONTÊM 'code' (errorCode, statusCode)", () => {
    const out = redactFields({ errorCode: "P2002", statusCode: 429, code: "654321", otp: "1" })
    expect(out.errorCode).toBe("P2002")
    expect(out.statusCode).toBe(429)
    expect(out.code).toBe("[oculto]")
    expect(out.otp).toBe("[oculto]")
  })

  it("mascara e-mail e não despeja objetos", () => {
    const out = redactFields({ email: "ana@teste.com", usuario: "bia@teste.com", payload: { senha: "x", nome: "Ana" } })
    expect(out.email).toBe("a**@teste.com")
    expect(out.usuario).toBe("b**@teste.com")
    expect(out.payload).toBe("[objeto omitido]")
  })
})

describe("logEvent", () => {
  let info: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    info = vi.spyOn(console, "info").mockImplementation(() => {})
    warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it("escreve UMA linha JSON no nível certo, com hora e evento", () => {
    logEvent("warn", "auth.login.failed", { email: "ana@teste.com", ip: "1.2.3.4" })
    expect(warn).toHaveBeenCalledTimes(1)
    const line = JSON.parse(warn.mock.calls[0][0] as string)
    expect(line).toMatchObject({ level: "warn", event: "auth.login.failed", email: "a**@teste.com", ip: "1.2.3.4" })
    expect(new Date(line.time).toString()).not.toBe("Invalid Date")
    logEvent("info", "x")
    logEvent("error", "y")
    expect(info).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("a linha final nunca contém o valor de um segredo", () => {
    logEvent("info", "teste", { senha: "SEGREDO-123", codigo: "654321", nota: "ok" })
    const texto = info.mock.calls[0][0] as string
    expect(texto).not.toContain("SEGREDO-123")
    expect(texto).not.toContain("654321")
  })
})

describe("describeError", () => {
  it("devolve só nome e código, nunca a mensagem (o Prisma pode incluir valores da consulta)", () => {
    const err = Object.assign(new Error("Unique constraint failed on email=ana@teste.com"), { code: "P2002" })
    err.name = "PrismaClientKnownRequestError"
    const d = describeError(err)
    expect(d).toEqual({ errorName: "PrismaClientKnownRequestError", errorCode: "P2002" })
    expect(JSON.stringify(d)).not.toContain("ana@teste.com")
  })
  it("aceita qualquer coisa lançada", () => {
    expect(describeError("texto")).toEqual({ errorName: "string" })
  })
})
