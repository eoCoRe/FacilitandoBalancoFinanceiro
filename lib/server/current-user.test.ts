import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O setup global troca getCurrentUser por um mock; aqui queremos a implementação de verdade.
vi.unmock("@/lib/server/current-user")

const { prisma, cookieStore } = vi.hoisted(() => ({
  prisma: { usuario: { findUnique: vi.fn() } },
  cookieStore: { value: undefined as string | undefined, set: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "cb_session" && cookieStore.value ? { value: cookieStore.value } : undefined),
    set: cookieStore.set,
  }),
}))

import { getCurrentUser } from "./current-user"
import { SESSION_RENEW_AFTER_SECONDS, signSessionToken, verifySessionToken } from "./session"

const usuario = (over = {}) => ({
  id: 7,
  email: "ana@teste.com",
  nome: "Ana",
  papel: "COORDENADOR",
  ativo: true,
  sessoesValidasDesde: new Date(Date.now() - 60_000),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", "z".repeat(40))
  cookieStore.value = undefined
})
afterEach(() => vi.unstubAllEnvs())

describe("getCurrentUser", () => {
  it("sem cookie → null, sem consultar o banco", async () => {
    expect(await getCurrentUser()).toBeNull()
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("cookie inválido → null", async () => {
    cookieStore.value = "lixo"
    expect(await getCurrentUser()).toBeNull()
  })

  it("sessão válida → o usuário com o perfil ATUAL do banco (não o do momento do login)", async () => {
    cookieStore.value = await signSessionToken(7)
    prisma.usuario.findUnique.mockResolvedValue(usuario({ papel: "ADMINISTRADOR" }))
    expect(await getCurrentUser()).toEqual({ id: 7, email: "ana@teste.com", nome: "Ana", papel: "ADMINISTRADOR" })
  })

  it("usuário desativado → null, mesmo com token ainda dentro do prazo", async () => {
    cookieStore.value = await signSessionToken(7)
    prisma.usuario.findUnique.mockResolvedValue(usuario({ ativo: false }))
    expect(await getCurrentUser()).toBeNull()
  })

  it("usuário removido → null", async () => {
    cookieStore.value = await signSessionToken(7)
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect(await getCurrentUser()).toBeNull()
  })

  it("senha trocada depois da emissão do token → sessão antiga é derrubada", async () => {
    cookieStore.value = await signSessionToken(7)
    prisma.usuario.findUnique.mockResolvedValue(usuario({ sessoesValidasDesde: new Date(Date.now() + 60_000) }))
    expect(await getCurrentUser()).toBeNull()
  })

  describe("renovação deslizante e teto absoluto", () => {
    const HORA = 3600
    // Última invalidação de sessões há 30 h: tokens emitidos horas atrás continuam legítimos (senão o teste
    // cairia na regra de "sessão encerrada" e provaria a coisa errada).
    const usuarioAntigo = () => usuario({ sessoesValidasDesde: new Date(Date.now() - 30 * HORA * 1000) })
    const agora = () => Math.floor(Date.now() / 1000)
    // Token com a emissão e o login original que quisermos (a mesma chave do app).
    const tokenCom = (iatHorasAtras: number, atHorasAtras: number) =>
      new SignJWT({ at: agora() - atHorasAtras * HORA })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("7")
        .setIssuedAt(agora() - iatHorasAtras * HORA)
        .setExpirationTime(agora() + 8 * HORA - iatHorasAtras * HORA)
        .sign(new TextEncoder().encode("z".repeat(40)))

    it("token recém-emitido NÃO é renovado (não regrava o cookie a cada requisição)", async () => {
      cookieStore.value = await signSessionToken(7)
      prisma.usuario.findUnique.mockResolvedValue(usuarioAntigo())
      expect(await getCurrentUser()).not.toBeNull()
      expect(cookieStore.set).not.toHaveBeenCalled()
    })

    it("passou de metade da vida do token: reemite o cookie e preserva o login ORIGINAL (sem esticar o teto)", async () => {
      cookieStore.value = await tokenCom(5, 5) // emitido há 5 h, login há 5 h
      prisma.usuario.findUnique.mockResolvedValue(usuarioAntigo())

      expect(await getCurrentUser()).toMatchObject({ id: 7 })

      expect(cookieStore.set).toHaveBeenCalledTimes(1)
      const [nome, novoToken, opcoes] = cookieStore.set.mock.calls[0]
      expect(nome).toBe("cb_session")
      expect(opcoes).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 8 * HORA })
      const renovado = await verifySessionToken(novoToken)
      expect(renovado!.issuedAt).toBeGreaterThanOrEqual(agora() - 2) // emitido AGORA
      expect(renovado!.authTime).toBeLessThanOrEqual(agora() - 5 * HORA + 2) // mas o login continua sendo o de 5 h atrás
    })

    it("o limite de renovação é a metade da vida do token", () => {
      expect(SESSION_RENEW_AFTER_SECONDS).toBe(4 * HORA)
    })

    it("teto absoluto: mais de 24 h desde o login, mesmo com token recém-renovado, a sessão acaba", async () => {
      cookieStore.value = await tokenCom(1, 25) // token novo (1 h), mas o login foi há 25 h
      prisma.usuario.findUnique.mockResolvedValue(usuarioAntigo())
      expect(await getCurrentUser()).toBeNull()
      expect(cookieStore.set).not.toHaveBeenCalled()
    })

    it("token antigo, sem o campo `at`, continua valendo (vale a emissão)", async () => {
      const semAt = await new SignJWT({})
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("7")
        .setIssuedAt(agora() - 60)
        .setExpirationTime("8h")
        .sign(new TextEncoder().encode("z".repeat(40)))
      cookieStore.value = semAt
      prisma.usuario.findUnique.mockResolvedValue(usuarioAntigo())
      expect(await getCurrentUser()).not.toBeNull()
    })

    it("se não der para gravar o cookie na renovação, a sessão continua valendo (não vira erro)", async () => {
      cookieStore.value = await tokenCom(5, 5)
      prisma.usuario.findUnique.mockResolvedValue(usuarioAntigo())
      cookieStore.set.mockImplementation(() => {
        throw new Error("cookies só podem ser alterados em Route Handlers")
      })
      expect(await getCurrentUser()).not.toBeNull()
    })

    it("renovação NÃO ressuscita uma sessão já encerrada (encerrar outras/trocar senha vale mais)", async () => {
      cookieStore.value = await tokenCom(5, 5)
      prisma.usuario.findUnique.mockResolvedValue(usuario({ sessoesValidasDesde: new Date() }))
      expect(await getCurrentUser()).toBeNull()
      expect(cookieStore.set).not.toHaveBeenCalled()
    })
  })
})
