import { describe, expect, it } from "vitest"
import { can, isPapel, PAPEIS, type Permission } from "./permissions"

const TODAS: Permission[] = ["consultar", "lancar-valores", "gerir-plano-de-contas", "editar-empresa", "exportar-auditoria", "auditar-exercicio", "selar-auditoria", "gerir-usuarios", "lgpd"]

describe("can", () => {
  it("analista consulta e lança, mas não gerencia estrutura, empresa, usuários nem LGPD", () => {
    expect(TODAS.filter((p) => can("ANALISTA", p))).toEqual(["consultar", "lancar-valores"])
  })

  it("coordenador acrescenta plano de contas e cadastro da empresa", () => {
    expect(TODAS.filter((p) => can("COORDENADOR", p))).toEqual([
      "consultar",
      "lancar-valores",
      "gerir-plano-de-contas",
      "editar-empresa",
      "exportar-auditoria",
      "auditar-exercicio",
    ])
  })

  it("administrador pode tudo", () => {
    expect(TODAS.every((p) => can("ADMINISTRADOR", p))).toBe(true)
  })

  it("sem perfil (não logado) não pode nada", () => {
    expect(TODAS.some((p) => can(undefined, p) || can(null, p))).toBe(false)
  })

  it("os perfis são cumulativos: quem sobe nunca perde uma permissão", () => {
    for (const permission of TODAS) {
      const flags = PAPEIS.map((papel) => can(papel, permission))
      expect(flags).toEqual([...flags].sort((a, b) => Number(a) - Number(b)))
    }
  })
})

describe("isPapel", () => {
  it("aceita só os três perfis", () => {
    expect(PAPEIS.every(isPapel)).toBe(true)
    expect(isPapel("admin")).toBe(false)
    expect(isPapel(undefined)).toBe(false)
  })
})
