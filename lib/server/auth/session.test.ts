import { SignJWT } from "jose"
import { NextResponse } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ServiceUnavailableError } from "@/lib/server/validation"
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, signSessionToken, verifySessionToken } from "@/lib/server/auth/session"

const SECRET = "x".repeat(40)
const key = (secret: string) => new TextEncoder().encode(secret)

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe("sessão", () => {
  it("ida e volta: o token devolve o id do usuário e quando foi emitido", async () => {
    const before = Math.floor(Date.now() / 1000)
    const session = await verifySessionToken(await signSessionToken(42))
    expect(session?.userId).toBe(42)
    expect(session!.issuedAt).toBeGreaterThanOrEqual(before)
  })

  it("recusa token adulterado", async () => {
    const [h, p, s] = (await signSessionToken(1)).split(".")
    const payloadForjado = Buffer.from(JSON.stringify({ sub: "2", iat: 1 })).toString("base64url")
    expect(await verifySessionToken(`${h}.${payloadForjado}.${s}`)).toBeNull()
    expect(await verifySessionToken(`${h}.${p}.${s}x`)).toBeNull()
  })

  it("recusa token assinado com outro segredo", async () => {
    const outro = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key("y".repeat(40)))
    expect(await verifySessionToken(outro)).toBeNull()
  })

  it("recusa token expirado", async () => {
    const agora = Math.floor(Date.now() / 1000)
    const velho = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("1")
      .setIssuedAt(agora - 7200)
      .setExpirationTime(agora - 3600)
      .sign(key(SECRET))
    expect(await verifySessionToken(velho)).toBeNull()
  })

  it("recusa alg none e lixo", async () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url")
    expect(await verifySessionToken(`${b64('{"alg":"none"}')}.${b64('{"sub":"1"}')}.`)).toBeNull()
    expect(await verifySessionToken("isso.nao.eh.jwt")).toBeNull()
    expect(await verifySessionToken("")).toBeNull()
  })

  it("recusa sub que não é um id válido", async () => {
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("abc")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key(SECRET))
    expect(await verifySessionToken(t)).toBeNull()
  })

  it("sem AUTH_SECRET o erro é de SERVIÇO INDISPONÍVEL (as rotas respondem 503 com a causa, não um 500 opaco)", async () => {
    vi.stubEnv("AUTH_SECRET", "")
    const erro = await signSessionToken(1).catch((e) => e)
    expect(erro).toBeInstanceOf(ServiceUnavailableError)
    expect(erro.message).toMatch(/AUTH_SECRET/)
  })

  it("falha fechado sem AUTH_SECRET ou com segredo curto (não emite nem aceita)", async () => {
    vi.stubEnv("AUTH_SECRET", "")
    await expect(signSessionToken(1)).rejects.toThrow(/AUTH_SECRET/)
    await expect(verifySessionToken("qualquer")).rejects.toThrow(/AUTH_SECRET/)
    vi.stubEnv("AUTH_SECRET", "curto")
    await expect(signSessionToken(1)).rejects.toThrow(/AUTH_SECRET/)
  })
})

describe("cookie de sessão", () => {
  it("é httpOnly, SameSite=Lax, com prazo, e Secure em produção", () => {
    vi.stubEnv("NODE_ENV", "production")
    const response = NextResponse.json({})
    setSessionCookie(response, "tok")
    const cookie = response.cookies.get(SESSION_COOKIE)!
    expect(cookie.value).toBe("tok")
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 8 * 60 * 60 })
  })

  it("logout zera o cookie", () => {
    const response = NextResponse.json({})
    clearSessionCookie(response)
    expect(response.cookies.get(SESSION_COOKIE)).toMatchObject({ value: "", maxAge: 0 })
  })

  it("guarda o momento do login original (authTime) e o preserva quando informado", async () => {
    const antes = Math.floor(Date.now() / 1000)
    expect((await verifySessionToken(await signSessionToken(1)))!.authTime).toBeGreaterThanOrEqual(antes)
    const original = antes - 5 * 3600
    const renovado = await verifySessionToken(await signSessionToken(1, original))
    expect(renovado!.authTime).toBe(original)
    expect(renovado!.issuedAt).toBeGreaterThanOrEqual(antes) // emitido agora, login de 5 h atrás
  })
})
