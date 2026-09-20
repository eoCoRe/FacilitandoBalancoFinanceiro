import { beforeEach, vi } from "vitest"
import { getCurrentUser } from "@/lib/server/auth/current-user"

// Nos testes de rota não há cookie nem sessão: getCurrentUser (que lê o cookie e consulta o
// banco) é trocado por um mock e, por padrão, "quem está logado" é um administrador — assim
// os testes existentes continuam focados na regra de negócio de cada rota. Os testes que
// tratam de acesso trocam o valor (null = sem login; outro papel = sem permissão).
// A regra de permissão em si (authz.ts / permissions.ts) NÃO é mockada: roda de verdade.
vi.mock("@/lib/server/auth/current-user", () => ({ getCurrentUser: vi.fn() }))

// Gravar auditoria também SELA o registro (audit-seal.ts), o que exige uma transação no banco. Nos testes de
// rota isso só atrapalharia (os mocks de prisma não têm transação), então a selagem vira "nada a selar". Os
// testes do próprio audit-seal.ts usam vi.unmock para exercitar o código de verdade.
vi.mock("@/lib/server/audit/audit-seal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/audit/audit-seal")>()),
  sealPending: vi.fn().mockResolvedValue(0),
}))

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: 1,
    email: "admin@teste.com",
    nome: "Admin Teste",
    papel: "ADMINISTRADOR",
  })
})
