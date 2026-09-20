import { beforeEach, describe, expect, it, vi } from "vitest"

const { prisma } = vi.hoisted(() => ({
  prisma: {
    empresa: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
  },
}))
vi.mock("@/lib/db", () => ({ prisma }))

import { getCurrentUser } from "@/lib/server/current-user"
import { GET } from "./route"

const get = (query = "") => GET(new Request(`http://localhost/api/auditoria/exportar${query ? "?" + query : ""}`))
const linha = (id: number, over = {}) => ({
  id,
  usuario: "ana@teste.com",
  acao: "Valor lançado",
  detalhe: "1.1.1 · 1T2026 = 945",
  criadoEm: new Date("2026-09-20T12:00:00.000Z"),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  prisma.empresa.findFirst.mockResolvedValue({ id: 1 })
  prisma.auditLog.findMany.mockResolvedValue([linha(2), linha(1, { acao: "Login realizado", detalhe: "Entrada" })])
})

describe("GET /api/auditoria/exportar", () => {
  it("devolve um CSV para download (BOM, cabeçalho, uma linha por registro)", async () => {
    const response = await get()
    // Response.text() descarta o BOM ao decodificar; para provar que ele está no arquivo, lê os bytes.
    const bytes = new Uint8Array(await response.arrayBuffer())
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)

    expect(response.status).toBe(200)
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(csv.startsWith("﻿")).toBe(true)
    const linhas = csv.replace("﻿", "").trim().split("\r\n")
    expect(linhas[0]).toBe('"Data/hora (UTC)","Usuário","Ação","Detalhe"')
    expect(linhas).toHaveLength(3)
    expect(linhas[1]).toBe('"2026-09-20T12:00:00.000Z","ana@teste.com","Valor lançado","1.1.1 · 1T2026 = 945"')
  })

  it("neutraliza injeção de fórmula em textos digitados por usuários (nome de conta etc.)", async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      linha(1, { detalhe: '=HYPERLINK("http://evil.example","clique")', usuario: "@cmd" }),
    ])
    const csv = await (await get()).text()
    expect(csv).toContain(`"'=HYPERLINK(`)
    expect(csv).toContain(`"'@cmd"`)
    expect(csv).not.toMatch(/,"=HYPERLINK/)
  })

  it("aplica os filtros, mas ignora cursor e limite (exportar é tudo o que bate, não uma página)", async () => {
    await get("usuario=ana&cursor=50&limite=5")
    const args = prisma.auditLog.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ empresaId: 1, usuario: { contains: "ana", mode: "insensitive" } })
    expect(args.take).toBe(10_000)
  })

  it("registra a exportação na própria auditoria (quem, quantos, com quais filtros)", async () => {
    await get("acao=Login%20realizado")
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: "Auditoria exportada",
        usuario: "admin@teste.com",
        detalhe: expect.stringMatching(/^2 registro\(s\); ação = "Login realizado"\.$/),
      }),
    })
  })

  it("avisa na auditoria quando o resultado foi cortado no limite de 10 mil linhas", async () => {
    prisma.auditLog.findMany.mockResolvedValue(Array.from({ length: 10_000 }, (_, i) => linha(10_000 - i)))
    await get()
    expect(prisma.auditLog.create.mock.calls[0][0].data.detalhe).toContain("limitado a 10000")
  })

  it("só coordenador ou acima baixa a trilha: analista leva 403 e nada é consultado", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 3, email: "a@teste.com", nome: "A", papel: "ANALISTA" })
    const response = await get()
    expect(response.status).toBe(403)
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })

  it("recusa filtro inválido com 400", async () => {
    expect((await get("de=nao-e-data")).status).toBe(400)
  })
})
