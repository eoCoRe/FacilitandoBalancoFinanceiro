"use client"

import { useMemo, useState } from "react"
import { Check } from "lucide-react"
import { GlossaryTerm } from "@/components/glossary-term"
import { PageHeader } from "@/components/page-header"
import { ScaleToggle } from "@/components/scale-toggle"
import { GLOSSARY } from "@/lib/glossary"
import { useFinancialStore } from "@/lib/store"
import {
  DRE_LINES,
  collectLeaves,
  computeDre,
  flattenAccounts,
  formatScaled,
  sumAccount,
  type Account,
  type DreLineDef,
  type Scale,
  type StaticLine,
} from "@/lib/financial-data"
import { cn } from "@/lib/utils"

type SubTab = "balanco" | "dre" | "dfc" | "balancete"

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "balanco", label: "Balanço" },
  { id: "dre", label: "DRE" },
  { id: "dfc", label: "DFC" },
  { id: "balancete", label: "Balancete" },
]

const SUB_TAB_SUBTITLE: Record<SubTab, string> = {
  balanco: GLOSSARY["Balanço Patrimonial"],
  dre: GLOSSARY.DRE,
  dfc: GLOSSARY.DFC,
  balancete: GLOSSARY.Balancete,
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}

function Head({ exercicioIds }: { exercicioIds: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border">
        <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Descrição
        </th>
        {exercicioIds.map((id) => (
          <th
            key={id}
            className="w-40 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            {id}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function BalancoTable({ accounts, exercicioIds, scale }: { accounts: Account[]; exercicioIds: string[]; scale: Scale }) {
  const rows = flattenAccounts(accounts)
  return (
    <TableShell>
      <Head exercicioIds={exercicioIds} />
      <tbody>
        {rows.map(({ account, depth }) => {
          const hasChildren = !!account.children?.length
          const isRoot = depth === 0
          return (
            <tr
              key={account.code}
              className={cn(
                "border-b border-border last:border-0",
                isRoot && "bg-primary/[0.03]",
                isRoot && "border-t-2 border-t-border first:border-t-0",
              )}
            >
              <td className="px-4 py-1.5" style={{ paddingLeft: `${depth * 18 + 16}px` }}>
                <GlossaryTerm
                  term={account.name}
                  className={cn(
                    "text-foreground",
                    isRoot ? "font-semibold uppercase tracking-wide" : hasChildren ? "font-medium" : "text-muted-foreground",
                  )}
                />
              </td>
              {exercicioIds.map((id) => (
                <td
                  key={id}
                  className={cn(
                    "px-4 py-1.5 text-right font-mono tabular-nums",
                    hasChildren ? "font-semibold text-foreground" : "text-muted-foreground",
                    isRoot && "underline decoration-border decoration-2 underline-offset-4",
                  )}
                >
                  {formatScaled(sumAccount(account, id), scale)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </TableShell>
  )
}

function DreTable({
  exercicioIds,
  computedByPeriod,
  scale,
}: {
  exercicioIds: string[]
  computedByPeriod: Record<string, Record<string, number | undefined>>
  scale: Scale
}) {
  return (
    <TableShell>
      <Head exercicioIds={exercicioIds} />
      <tbody>
        {DRE_LINES.map((line: DreLineDef) => {
          const isTotal = !!line.isTotal
          const isSubtotal = line.kind === "computed" && !isTotal
          return (
            <tr key={line.id} className={cn("border-b border-border last:border-0", isTotal && "bg-primary/[0.03]")}>
              <td className="px-4 py-1.5">
                <GlossaryTerm
                  term={line.name}
                  className={cn(
                    "text-foreground",
                    isTotal ? "font-semibold" : isSubtotal ? "font-medium" : line.deduction ? "text-muted-foreground" : "",
                  )}
                />
              </td>
              {exercicioIds.map((id) => {
                const value = computedByPeriod[id]?.[line.id]
                return (
                  <td
                    key={id}
                    className={cn(
                      "px-4 py-1.5 text-right font-mono tabular-nums",
                      isTotal
                        ? "font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4"
                        : isSubtotal
                          ? "font-medium text-foreground"
                          : value !== undefined && value < 0
                            ? "text-risk"
                            : "text-muted-foreground",
                    )}
                  >
                    {formatScaled(value, scale)}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </TableShell>
  )
}

function StaticStatementTable({ lines, exercicioIds, scale }: { lines: StaticLine[]; exercicioIds: string[]; scale: Scale }) {
  return (
    <TableShell>
      <Head exercicioIds={exercicioIds} />
      <tbody>
        {lines.map((line) => {
          const isTotal = line.kind === "total"
          const isSubtotal = line.kind === "subtotal"
          return (
            <tr key={line.name} className={cn("border-b border-border last:border-0", isTotal && "bg-primary/[0.03]")}>
              <td className="px-4 py-1.5">
                <GlossaryTerm
                  term={line.name}
                  className={cn("text-foreground", isTotal ? "font-semibold" : isSubtotal ? "font-medium" : "")}
                />
              </td>
              {exercicioIds.map((id) => (
                <td
                  key={id}
                  className={cn(
                    "px-4 py-1.5 text-right font-mono tabular-nums",
                    isTotal
                      ? "font-semibold text-foreground underline decoration-border decoration-2 underline-offset-4"
                      : isSubtotal
                        ? "font-medium text-foreground"
                        : (line.values[id] ?? 0) < 0
                          ? "text-risk"
                          : "text-muted-foreground",
                  )}
                >
                  {formatScaled(line.values[id], scale)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </TableShell>
  )
}

function BalanceteTable({ accounts, period, scale }: { accounts: Account[]; period: string | undefined; scale: Scale }) {
  const leaves = collectLeaves(accounts)
  return (
    <TableShell>
      <thead>
        <tr className="border-b border-border">
          <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Código
          </th>
          <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Conta
          </th>
          <th className="w-40 px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Saldo {period ?? "—"}
          </th>
        </tr>
      </thead>
      <tbody>
        {leaves.map((account) => (
          <tr key={account.code} className="border-b border-border last:border-0">
            <td className="px-4 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">{account.code}</td>
            <td className="px-4 py-1.5">
              <GlossaryTerm term={account.name} className="text-foreground" />
            </td>
            <td className="px-4 py-1.5 text-right font-mono tabular-nums text-foreground">
              {period ? formatScaled(sumAccount(account, period), scale) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

export function DemonstracoesScreen() {
  const store = useFinancialStore()
  const [tab, setTab] = useState<SubTab>("balanco")
  const [scale, setScale] = useState<Scale>("milhares")

  const exercicioIds = useMemo(() => store.exercicios.map((e) => e.id), [store.exercicios])
  const lastPeriod = exercicioIds[exercicioIds.length - 1]

  const computedByPeriod = useMemo(() => {
    const out: Record<string, Record<string, number | undefined>> = {}
    for (const id of exercicioIds) out[id] = computeDre(store.dreByExercicio[id] ?? {})
    return out
  }, [exercicioIds, store.dreByExercicio])

  const ativo = store.accounts.find((a) => a.name === "Ativo")
  const passivo = store.accounts.find((a) => a.name === "Passivo")
  const checks = exercicioIds.map((id) => {
    const a = ativo ? sumAccount(ativo, id) : undefined
    const p = passivo ? sumAccount(passivo, id) : undefined
    return { period: id, ok: a !== undefined && p !== undefined && a === p }
  })

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Demonstrações consolidadas"
        title="Balanço · DRE · DFC"
        subtitle={SUB_TAB_SUBTITLE[tab]}
        actions={<ScaleToggle value={scale} onChange={setScale} />}
      />

      {/* Sub-abas */}
      <div className="border-b border-border px-8">
        <div className="flex gap-1" role="tablist" aria-label="Demonstração">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
                tab === t.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6">
        {tab === "balanco" && <BalancoTable accounts={store.accounts} exercicioIds={exercicioIds} scale={scale} />}
        {tab === "dre" && <DreTable exercicioIds={exercicioIds} computedByPeriod={computedByPeriod} scale={scale} />}
        {tab === "dfc" && <StaticStatementTable lines={store.dfc} exercicioIds={exercicioIds} scale={scale} />}
        {tab === "balancete" && <BalanceteTable accounts={store.accounts} period={lastPeriod} scale={scale} />}
      </div>

      {/* Barra escura de verificação */}
      {(tab === "balanco" || tab === "balancete") && (
        <div className="mt-auto">
          <div className="mx-8 mb-6 flex flex-col gap-3 rounded-md bg-primary px-5 py-3.5 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-primary-foreground/70">
              Check Ativo × Passivo
            </span>
            <div className="flex flex-wrap gap-4">
              {checks.map((c) => (
                <span key={c.period} className="inline-flex items-center gap-1.5 font-mono text-sm tabular-nums">
                  <span
                    className={cn(
                      "inline-flex size-4 items-center justify-center rounded-full",
                      c.ok ? "bg-ok text-ok-foreground" : "bg-risk text-risk-foreground",
                    )}
                  >
                    <Check className="size-3" />
                  </span>
                  {c.period}
                  <span className="text-primary-foreground/60">{c.ok ? "OK" : "Inconsistente"}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
