import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// O setup global troca getCurrentUser por um mock; aqui queremos a implementação de verdade.
vi.unmock("@/lib/server/current-user")

const { prisma, cookieStore } = vi.hoisted(() => ({
  prisma: { usuario: { findUnique: vi.fn() } },
  cookieStore: { value: undefined as string | undefined },
}))

vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "cb_session" && cookieStore.value ? { value: cookieStore.value } : undefined),
  }),
}))

import { getCurrentUser } from "./current-user"
import { signSessionToken } from "./session"

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
})
