import { beforeEach, vi } from "vitest"
import { getCurrentUser } from "@/lib/server/current-user"

// Nos testes de rota não há cookie nem sessão: getCurrentUser (que lê o cookie e consulta o
// banco) é trocado por um mock e, por padrão, "quem está logado" é um administrador — assim
// os testes existentes continuam focados na regra de negócio de cada rota. Os testes que
// tratam de acesso trocam o valor (null = sem login; outro papel = sem permissão).
// A regra de permissão em si (authz.ts / permissions.ts) NÃO é mockada: roda de verdade.
vi.mock("@/lib/server/current-user", () => ({ getCurrentUser: vi.fn() }))

beforeEach(() => {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id: 1,
    email: "admin@teste.com",
    nome: "Admin Teste",
    papel: "ADMINISTRADOR",
  })
})
