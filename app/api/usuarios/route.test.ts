import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    empresa: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { verifyPassword } from "@/lib/server/password"
import { GET, POST } from "./route"
import { PATCH } from "./[id]/route"

const row = (over = {}) => ({
  id: 2,
  email: "ana@teste.com",
  nome: "Ana",
  papel: "ANALISTA",
  ativo: true,
  senhaHash: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
  googleSub: "g-1",
  criadoEm: new Date(),
  ultimoLoginEm: null,
  sessoesValidasDesde: new Date(),
  ...over,
})
const post = (body: unknown) => POST(new Request("http://localhost/api/usuarios", { method: "POST", body: JSON.stringify(body) }))
const patch = (id: number, body: unknown) =>
  PATCH(new Request("http://localhost/api/usuarios/x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: String(id) }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
})

describe("GET /api/usuarios", () => {
  it("lista sem NUNCA expor o hash da senha nem o googleSub", async () => {
    prisma.usuario.findMany.mockResolvedValue([row()])
    const body = await (await GET()).json()
    expect(body.usuarios[0]).toMatchObject({ email: "ana@teste.com", temSenha: true, temGoogle: true })
    const texto = JSON.stringify(body)
    expect(texto).not.toMatch(/scrypt|senhaHash|googleSub|g-1/)
  })
})

describe("POST /api/usuarios", () => {
  it("cria com senha em hash (nunca em texto), e-mail normalizado e auditoria com o admin", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    prisma.usuario.create.mockImplementation(async ({ data }) => row({ ...data, id: 9 }))

    const response = await post({ nome: "Bia", email: " BIA@Teste.com ", papel: "COORDENADOR", senha: "senha-da-bia-123" })

    expect(response.status).toBe(201)
    const data = prisma.usuario.create.mock.calls[0][0].data
    expect(data).toMatchObject({ nome: "Bia", email: "bia@teste.com", papel: "COORDENADOR" })
    expect(data.senhaHash).not.toContain("senha-da-bia-123")
    expect(await verifyPassword("senha-da-bia-123", data.senhaHash)).toBe(true)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Usuário criado", usuario: "admin@teste.com" }),
    })
  })

  it("permite criar sem senha (quem só entra pelo Google)", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    prisma.usuario.create.mockImplementation(async ({ data }) => row({ ...data, senhaHash: null }))
    expect((await post({ nome: "Caio", email: "caio@teste.com", papel: "ANALISTA" })).status).toBe(201)
    expect(prisma.usuario.create.mock.calls[0][0].data.senhaHash).toBeNull()
  })

  it("recusa e-mail já cadastrado, perfil inventado e senha fraca", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row())
    expect((await post({ nome: "A", email: "ana@teste.com", papel: "ANALISTA" })).status).toBe(400)
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect((await post({ nome: "A", email: "a@teste.com", papel: "SUPERUSER" })).status).toBe(400)
    expect((await post({ nome: "A", email: "a@teste.com", papel: "ANALISTA", senha: "curta" })).status).toBe(400)
    expect(prisma.usuario.create).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/usuarios/:id", () => {
  it("muda o perfil e audita com quem mudou", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row())
    prisma.usuario.update.mockResolvedValue(row({ papel: "COORDENADOR" }))

    const response = await patch(2, { papel: "COORDENADOR" })

    expect(response.status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { papel: "COORDENADOR" } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Usuário atualizado", usuario: "admin@teste.com" }),
    })
  })

  it("redefinir a senha grava o hash e derruba as sessões abertas da pessoa", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row())
    prisma.usuario.update.mockResolvedValue(row())
    await patch(2, { senha: "nova-senha-da-ana-1" })
    const data = prisma.usuario.update.mock.calls[0][0].data
    expect(await verifyPassword("nova-senha-da-ana-1", data.senhaHash)).toBe(true)
    expect(data.sessoesValidasDesde).toBeInstanceOf(Date)
  })

  it("não deixa o admin rebaixar nem desativar a si mesmo", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row({ id: 1, email: "admin@teste.com", papel: "ADMINISTRADOR" }))
    expect((await patch(1, { papel: "ANALISTA" })).status).toBe(400)
    expect((await patch(1, { ativo: false })).status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("não deixa remover o ÚLTIMO administrador ativo (rebaixando ou desativando)", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row({ id: 3, papel: "ADMINISTRADOR" }))
    prisma.usuario.count.mockResolvedValue(0)
    expect((await patch(3, { papel: "COORDENADOR" })).status).toBe(400)
    expect((await patch(3, { ativo: false })).status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("permite rebaixar outro administrador quando ainda sobra ao menos um", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row({ id: 3, papel: "ADMINISTRADOR" }))
    prisma.usuario.count.mockResolvedValue(1)
    prisma.usuario.update.mockResolvedValue(row({ id: 3, papel: "COORDENADOR" }))
    expect((await patch(3, { papel: "COORDENADOR" })).status).toBe(200)
  })

  it("admin pode DESLIGAR o 2FA de alguém (perdeu o e-mail), mas não ligar", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row({ doisFatoresAtivo: true }))
    prisma.usuario.update.mockResolvedValue(row({ doisFatoresAtivo: false }))
    expect((await patch(2, { doisFatoresAtivo: false })).status).toBe(200)
    expect(prisma.usuario.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { doisFatoresAtivo: false } })
    prisma.usuario.update.mockClear()
    expect((await patch(2, { doisFatoresAtivo: true })).status).toBe(400)
    expect(prisma.usuario.update).not.toHaveBeenCalled()
  })

  it("recusa corpo vazio, perfil inválido e usuário inexistente", async () => {
    prisma.usuario.findUnique.mockResolvedValue(row())
    expect((await patch(2, {})).status).toBe(400)
    expect((await patch(2, { papel: "ROOT" })).status).toBe(400)
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect((await patch(99, { ativo: false })).status).toBe(400)
  })
})
