import type { LucideIcon } from "lucide-react"
import { LayoutDashboard, ListTree, Table2, FileSpreadsheet, Percent, FilePlus2, Gavel, Users, ScrollText } from "lucide-react"

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
  // Outros nomes pelos quais a tela é procurada na busca (Ctrl+K).
  keywords?: string
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
  { id: "extracao-ia", label: "Incluir balanços", icon: FilePlus2, keywords: "extração pdf leitura digitação manual documento" },
  { id: "auditoria", label: "Auditoria", icon: ScrollText },
]

// Só aparece para quem tem a permissão "gerir-usuarios" (ver lib/permissions.ts).
export const ADMIN_NAV: NavItem[] = [{ id: "usuarios", label: "Usuários", icon: Users }]
