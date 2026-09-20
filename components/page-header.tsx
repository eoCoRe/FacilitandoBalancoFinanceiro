import type { ReactNode } from "react"

interface PageHeaderProps {
  eyebrow: string
  title: string
  subtitle: string
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-8 py-6">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-foreground text-balance">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">{subtitle}</p>
      </div>
      {actions && <div className="flex items-center gap-2 print:hidden">{actions}</div>}
    </header>
  )
}
