import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    usuario: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
    empresa: { findFirst: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { GET } from "./route"

const usuario = (over = {}) => ({
  id: 5,
  email: "ana@teste.com",
  nome: "Ana",
  papel: "ANALISTA",
  ativo: true,
  senhaHash: "scrypt$65536$8$2$c2FsdA==$aGFzaC1zZWNyZXRv",
  googleSub: "google-id-interno-123",
  doisFatoresAtivo: true,
  criadoEm: new Date("2026-01-01T00:00:00Z"),
  ultimoLoginEm: new Date("2026-09-20T10:00:00Z"),
  sessoesValidasDesde: new Date("2026-09-20T09:00:00Z"),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 5, email: "ana@teste.com", nome: "Ana", papel: "ANALISTA" })
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.usuario.findUnique.mockResolvedValue(usuario())
  prisma.auditLog.findMany.mockResolvedValue([
    { criadoEm: new Date("2026-09-20T10:00:00Z"), acao: "Login realizado", detalhe: "Entrada com e-mail e senha." },
  ])
})

describe("GET /api/auth/meus-dados", () => {
  it("devolve o cadastro, as formas de acesso e as ações da própria pessoa, como arquivo para baixar", async () => {
    const response = await GET()
    const corpo = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="meus-dados-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(corpo.cadastro).toMatchObject({ nome: "Ana", email: "ana@teste.com", perfil: "ANALISTA", ativo: true })
    expect(corpo.formasDeAcesso).toEqual({ senha: true, contaGoogleVinculada: true, verificacaoEmDuasEtapas: true })
    expect(corpo.acoesRegistradas.total).toBe(1)
    expect(corpo.acoesRegistradas.itens[0]).toMatchObject({ acao: "Login realizado" })
  })

  it("NUNCA inclui segredos nem mecanismo interno: hash da senha, id do Google, controle de sessões", async () => {
    const texto = await (await GET()).text()
    expect(texto).not.toContain("scrypt")
    expect(texto).not.toContain("aGFzaC1zZWNyZXRv")
    expect(texto).not.toContain("google-id-interno-123")
    expect(texto).not.toMatch(/senhaHash|googleSub|sessoesValidasDesde/)
  })

  it("busca as ações SÓ da pessoa logada (pelo e-mail da sessão), mesmo que a rota receba outros parâmetros", async () => {
    await GET()
    expect(prisma.usuario.findUnique).toHaveBeenCalledWith({ where: { id: 5 } })
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { usuario: "ana@teste.com" } }),
    )
  })

  it("registra na auditoria que a pessoa baixou os próprios dados", async () => {
    await GET()
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ acao: "Dados pessoais exportados", usuario: "ana@teste.com" }),
    })
  })

  it("limita o volume de ações do arquivo", async () => {
    await GET()
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(5000)
  })

  it("quem não usa senha nem Google vinculado aparece assim, sem quebrar", async () => {
    prisma.usuario.findUnique.mockResolvedValue(usuario({ senhaHash: null, googleSub: null, doisFatoresAtivo: false, ultimoLoginEm: null }))
    const corpo = await (await GET()).json()
    expect(corpo.formasDeAcesso).toEqual({ senha: false, contaGoogleVinculada: false, verificacaoEmDuasEtapas: false })
    expect(corpo.cadastro.ultimoAcessoEm).toBeNull()
  })

  it("sem login: 401, nada é consultado", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(prisma.usuario.findUnique).not.toHaveBeenCalled()
  })

  it("usuário que sumiu do banco depois do login: 400", async () => {
    prisma.usuario.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(400)
  })
})
