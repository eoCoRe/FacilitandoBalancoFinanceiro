import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    exercicio: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/auth/current-user"
import { GET, PATCH, POST } from "./route"

function buildPatchRequest(body: unknown) {
  return new Request("http://localhost/api/empresa", { method: "PATCH", body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/empresa", () => {
  it("retorna a empresa e seus exercícios", async () => {
    prisma.empresa.findFirst.mockResolvedValue({
      id: 1,
      cnpj: "12.345.678/0001-90",
      razaoSocial: "Farmácia Bem-Estar Ltda",
      setor: "Comércio Varejista",
    })
    prisma.exercicio.findMany.mockResolvedValue([
      { id: 1, periodo: "4T2024", auditado: false },
      { id: 2, periodo: "1T2025", auditado: false },
    ])

    const response = await GET()
    const body = await response.json()

    expect(body.razaoSocial).toBe("Farmácia Bem-Estar Ltda")
    expect(body.exercicios).toHaveLength(2)
    expect(body.exercicios[0]).toEqual({ id: 1, periodo: "4T2024", auditado: false })
  })

  it("sem empresa cadastrada: 409 com o código SEM_EMPRESA (a tela oferece o cadastro)", async () => {
    prisma.empresa.findFirst.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ codigo: "SEM_EMPRESA" })
  })
})

describe("POST /api/empresa (cadastrar a primeira empresa)", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/empresa", { method: "POST", body: JSON.stringify(body) }))
  beforeEach(() => {
    prisma.empresa.findFirst.mockResolvedValue(null)
    prisma.empresa.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 1, ...data }))
  })

  it("cria a empresa com o CNPJ formatado, setor padrão e registra na auditoria", async () => {
    const response = await post({ cnpj: "11222333000181", razaoSocial: "  Mercado Bom Ltda " })
    expect(response.status).toBe(201)
    expect(prisma.empresa.create).toHaveBeenCalledWith({
      data: { cnpj: "11.222.333/0001-81", razaoSocial: "Mercado Bom Ltda", setor: expect.any(String) },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ acao: "Empresa cadastrada", usuario: "admin@teste.com" }) })
  })

  it("recusa CNPJ inválido, razão social vazia e CNPJ ausente", async () => {
    expect((await post({ cnpj: "11.222.333/0001-82", razaoSocial: "X" })).status).toBe(400)
    expect((await post({ cnpj: "11222333000181", razaoSocial: "  " })).status).toBe(400)
    expect((await post({ razaoSocial: "X" })).status).toBe(400)
    expect(prisma.empresa.create).not.toHaveBeenCalled()
  })

  it("já existe uma empresa: 400 e nada é criado (o sistema trabalha com uma só)", async () => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
    expect((await post({ cnpj: "11222333000181", razaoSocial: "X" })).status).toBe(400)
    expect(prisma.empresa.create).not.toHaveBeenCalled()
  })

  it("só administrador cadastra: coordenador leva 403", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 2, email: "c@teste.com", nome: "C", papel: "COORDENADOR" })
    expect((await post({ cnpj: "11222333000181", razaoSocial: "X" })).status).toBe(403)
    expect(prisma.empresa.create).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/empresa", () => {
  beforeEach(() => {
    prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  })

  it("rejeita corpo sem razaoSocial nem setor", async () => {
    const response = await PATCH(buildPatchRequest({}))
    expect(response.status).toBe(400)
    expect(prisma.empresa.update).not.toHaveBeenCalled()
  })

  it("rejeita setor vazio", async () => {
    const response = await PATCH(buildPatchRequest({ setor: "  " }))
    expect(response.status).toBe(400)
    expect(prisma.empresa.update).not.toHaveBeenCalled()
  })

  it("atualiza só o setor quando é o único campo informado, e registra auditoria", async () => {
    prisma.empresa.update.mockResolvedValue({ id: 1, setor: "Indústria de Transformação" })

    const response = await PATCH(buildPatchRequest({ setor: "Indústria de Transformação" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.setor).toBe("Indústria de Transformação")
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { setor: "Indústria de Transformação" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ acao: "Empresa atualizada" }) }),
    )
  })

  it("atualiza só a razaoSocial quando é o único campo informado", async () => {
    prisma.empresa.update.mockResolvedValue({ id: 1, razaoSocial: "Nova Razão Social Ltda" })

    const response = await PATCH(buildPatchRequest({ razaoSocial: "Nova Razão Social Ltda" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.razaoSocial).toBe("Nova Razão Social Ltda")
    expect(prisma.empresa.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { razaoSocial: "Nova Razão Social Ltda" } })
  })

  it("atualiza razaoSocial e setor juntos quando ambos são informados", async () => {
    prisma.empresa.update.mockResolvedValue({ id: 1, razaoSocial: "Nova Razão Social Ltda", setor: "Serviços" })

    const response = await PATCH(buildPatchRequest({ razaoSocial: "Nova Razão Social Ltda", setor: "Serviços" }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.razaoSocial).toBe("Nova Razão Social Ltda")
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { razaoSocial: "Nova Razão Social Ltda", setor: "Serviços" },
    })
  })

  it("rejeita razaoSocial vazia mesmo com setor válido informado junto", async () => {
    const response = await PATCH(buildPatchRequest({ razaoSocial: "  ", setor: "Serviços" }))
    expect(response.status).toBe(400)
    expect(prisma.empresa.update).not.toHaveBeenCalled()
  })

  it("rejeita corpo com JSON malformado", async () => {
    const response = await PATCH(new Request("http://localhost/api/empresa", { method: "PATCH", body: "{ não é json" }))
    expect(response.status).toBe(400)
    expect(prisma.empresa.update).not.toHaveBeenCalled()
  })
})
