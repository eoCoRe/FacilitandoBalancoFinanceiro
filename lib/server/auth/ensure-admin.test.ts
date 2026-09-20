import { beforeEach, describe, expect, it, vi } from "vitest"
import { ensureAdmin } from "./ensure-admin"
import { verifyPassword } from "./password"

const prisma = { usuario: { count: vi.fn(), upsert: vi.fn() } }
const log = { log: vi.fn(), warn: vi.fn() }
const run = (env: Record<string, string | undefined>) => ensureAdmin(prisma as never, env, log as never)

beforeEach(() => {
  vi.clearAllMocks()
  prisma.usuario.count.mockResolvedValue(1)
})

describe("ensureAdmin", () => {
  it("cria o administrador (e-mail em minúsculas) com a senha do ambiente, guardada só como hash", async () => {
    const resultado = await run({ SEED_ADMIN_EMAIL: "  Admin@Exemplo.COM ", SEED_ADMIN_PASSWORD: "uma-senha-forte-123", SEED_ADMIN_NAME: "Chefe" })
    expect(resultado).toEqual({ email: "admin@exemplo.com" })

    const { where, create, update } = prisma.usuario.upsert.mock.calls[0][0]
    expect(where).toEqual({ email: "admin@exemplo.com" })
    expect(create).toMatchObject({ email: "admin@exemplo.com", nome: "Chefe", papel: "ADMINISTRADOR" })
    expect(create.senhaHash).not.toContain("uma-senha-forte-123")
    expect(await verifyPassword("uma-senha-forte-123", create.senhaHash)).toBe(true)
    // já existia: vira administrador ativo, com a senha nova, e as sessões abertas dele caem
    expect(update).toMatchObject({ papel: "ADMINISTRADOR", ativo: true, senhaHash: create.senhaHash })
    expect(update.sessoesValidasDesde).toBeInstanceOf(Date)
  })

  it("nome padrão quando não informado", async () => {
    await run({ SEED_ADMIN_EMAIL: "a@b.com", SEED_ADMIN_PASSWORD: "uma-senha-forte-123" })
    expect(prisma.usuario.upsert.mock.calls[0][0].create.nome).toBe("Administrador")
  })

  it("senha fraca (curta) é recusada e nada é gravado", async () => {
    await expect(run({ SEED_ADMIN_EMAIL: "a@b.com", SEED_ADMIN_PASSWORD: "curta" })).rejects.toThrow()
    expect(prisma.usuario.upsert).not.toHaveBeenCalled()
  })

  it.each([
    [{ SEED_ADMIN_EMAIL: "a@b.com" }],
    [{ SEED_ADMIN_PASSWORD: "uma-senha-forte-123" }],
    [{}],
  ])("sem e-mail ou sem senha (%j) não grava nada", async (env) => {
    expect(await run(env)).toBeNull()
    expect(prisma.usuario.upsert).not.toHaveBeenCalled()
  })

  it("sem variáveis, avisa se já existe administrador e alerta se NÃO existe nenhum", async () => {
    prisma.usuario.count.mockResolvedValue(2)
    await run({})
    expect(log.warn.mock.calls[0][0]).toMatch(/mantendo os administradores existentes/)

    prisma.usuario.count.mockResolvedValue(0)
    await run({})
    expect(log.warn.mock.calls[1][0]).toMatch(/nenhum administrador existe/)
  })
})
