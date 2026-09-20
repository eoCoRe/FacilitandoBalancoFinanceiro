// Perfis e permissões (RNF02). Puro, sem servidor nem React, para que a MESMA regra decida
// no servidor (que é quem de fato barra) e na tela (que só esconde o que não caberia usar).

export const PAPEIS = ["ANALISTA", "COORDENADOR", "ADMINISTRADOR"] as const
export type Papel = (typeof PAPEIS)[number]

// Quem é o usuário logado, no formato comum ao servidor (sessão) e à tela (/api/auth/me).
export interface UserIdentity {
  id: number
  nome: string
  email: string
  papel: Papel
}

export const PAPEL_LABEL: Record<Papel, string> = {
  ANALISTA: "Analista de Crédito",
  COORDENADOR: "Coordenador",
  ADMINISTRADOR: "Administrador",
}

export type Permission =
  | "consultar" // ver empresa, contas, DRE, DFC, índices, auditoria e extrações
  | "lancar-valores" // tabular Balanço/DRE, abrir exercícios, confirmar extrações
  | "gerir-plano-de-contas" // criar, renomear e excluir contas
  | "editar-empresa" // razão social e setor
  | "cadastrar-empresa" // criar a empresa quando não existe nenhuma (instalação nova ou depois da eliminação LGPD)
  | "exportar-auditoria" // baixar a trilha de auditoria inteira em CSV
  | "auditar-exercicio" // marcar/desmarcar um exercício como auditado
  | "selar-auditoria" // selar à mão registros que ficaram sem selo (ação excepcional, fica na trilha)
  | "gerir-usuarios"
  | "lgpd" // exportar e eliminar dados (Art. 18)

// Perfil mínimo para cada permissão; os perfis são cumulativos (coordenador pode tudo que o
// analista pode, e assim por diante).
const MIN_PAPEL: Record<Permission, Papel> = {
  consultar: "ANALISTA",
  "lancar-valores": "ANALISTA",
  "gerir-plano-de-contas": "COORDENADOR",
  "editar-empresa": "COORDENADOR",
  "cadastrar-empresa": "ADMINISTRADOR",
  "exportar-auditoria": "COORDENADOR",
  "auditar-exercicio": "COORDENADOR",
  "selar-auditoria": "ADMINISTRADOR",
  "gerir-usuarios": "ADMINISTRADOR",
  lgpd: "ADMINISTRADOR",
}

export function isPapel(value: unknown): value is Papel {
  return typeof value === "string" && (PAPEIS as readonly string[]).includes(value)
}

export function can(papel: Papel | undefined | null, permission: Permission): boolean {
  if (!papel) return false
  return PAPEIS.indexOf(papel) >= PAPEIS.indexOf(MIN_PAPEL[permission])
}
