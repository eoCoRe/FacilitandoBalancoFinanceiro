"use client"

import { Search } from "lucide-react"
import { COMPANY } from "@/lib/financial-data"
import { INICIO_NAV, ANALISE_NAV, DETALHADO_NAV, type NavItem, type ScreenId } from "@/lib/navigation"
import { cn } from "@/lib/utils"

interface AppSidebarProps {
  active: ScreenId
  onNavigate: (id: ScreenId) => void
}

export function AppSidebar({ active, onNavigate }: AppSidebarProps) {
  return (
    <aside className="flex h-dvh w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Marca */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">
          CB
        </div>
        <span className="font-display text-sm font-bold tracking-tight text-foreground">Central de Balanços</span>
      </div>

      {/* Busca */}
      <div className="px-3 pb-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-left text-sm text-muted-foreground transition-all duration-150 hover:border-ring/50 hover:shadow-sm hover:shadow-primary/10"
        >
          <Search className="size-3.5" />
          <span className="flex-1">Buscar…</span>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Empresa selecionada */}
      <div className="px-3 pb-4">
        <div className="rounded-md border border-border bg-background p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Empresa</p>
          <p className="mt-1 text-sm font-medium leading-tight text-foreground text-pretty">{COMPANY.name}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{COMPANY.cnpj}</p>
        </div>
      </div>

      {/* Navegação */}
      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="flex flex-col gap-0.5">
          {INICIO_NAV.map((item) => (
            <li key={item.id}>
              <NavButton item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />
            </li>
          ))}
        </ul>

        <p className="px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Análise
        </p>
        <ul className="flex flex-col gap-0.5">
          {ANALISE_NAV.map((item) => (
            <li key={item.id}>
              <NavButton item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />
            </li>
          ))}
        </ul>

        <p className="px-2 pb-1 pt-5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Detalhado
        </p>
        <ul className="flex flex-col gap-0.5">
          {DETALHADO_NAV.map((item) => (
            <li key={item.id}>
              <NavButton item={item} active={active === item.id} onClick={() => onNavigate(item.id)} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Rodapé usuário */}
      <div className="mt-auto border-t border-border p-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/90 text-xs font-medium text-primary-foreground">
            RA
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">Renata Alves</p>
            <p className="truncate text-xs text-muted-foreground">Analista de Crédito</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav flex w-full items-center gap-2.5 rounded-full px-3 py-1.5 text-sm transition-all duration-150",
        active
          ? "bg-primary font-semibold text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active ? "text-primary-foreground" : "text-muted-foreground group-hover/nav:text-foreground",
        )}
      />
      <span className="flex-1 text-left">{item.label}</span>
      {item.badge && (
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {item.badge}
        </span>
      )}
    </button>
  )
}
