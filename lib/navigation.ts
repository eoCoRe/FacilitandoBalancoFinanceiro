import type { LucideIcon } from "lucide-react"
import { LayoutDashboard, ListTree, Table2, FileSpreadsheet, Percent, Sparkles, Gavel, Users, ScrollText } from "lucide-react"

export type ScreenId =
  | "dashboard"
  | "plano-de-contas"
  | "tabulacao"
  | "demonstracoes"
  | "indices"
  | "opiniao-de-venda"
  | "extracao-ia"
  | "usuarios"
  | "auditoria"

export interface NavItem {
  id: ScreenId
  label: string
  icon: LucideIcon
  badge?: string
}

export const INICIO_NAV: NavItem[] = [{ id: "opiniao-de-venda", label: "Parecer de Crédito", icon: Gavel }]

export const ANALISE_NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "indices", label: "Índices Financeiros", icon: Percent },
]

export const DETALHADO_NAV: NavItem[] = [
  { id: "plano-de-contas", label: "Plano de Contas", icon: ListTree },
  { id: "tabulacao", label: "Tabulação", icon: Table2 },
  { id: "demonstracoes", label: "Balanço · DRE · DFC", icon: FileSpreadsheet },
  { id: "extracao-ia", label: "Extração via IA", icon: Sparkles, badge: "beta" },
  { id: "auditoria", label: "Auditoria", icon: ScrollText },
]

// Só aparece para quem tem a permissão "gerir-usuarios" (ver lib/permissions.ts).
export const ADMIN_NAV: NavItem[] = [{ id: "usuarios", label: "Usuários", icon: Users }]
