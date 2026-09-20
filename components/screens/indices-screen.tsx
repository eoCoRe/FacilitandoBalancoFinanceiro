"use client"

import { useMemo } from "react"
import { ChevronDown, Info, Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { can } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import {
  computeDre,
  formatIndicatorValue,
  indicatorStatus,
  INDICATORS,
  makeIndicatorContext,
  type Indicator,
  type IndicatorContext,
  type IndicatorStatus,
} from "@/lib/financial-data"
import { sectorBenchmarkFor, SECTORS } from "@/lib/sector-benchmarks"
import { cn } from "@/lib/utils"

type BenchmarkComparison = "acima" | "abaixo" | "indisponivel"

function compareToBenchmark(indicator: Indicator, value: number | undefined, benchmark: number | undefined): BenchmarkComparison {
  if (value === undefined || benchmark === undefined) return "indisponivel"
  if (value === benchmark) return indicator.higherIsBetter ? "acima" : "abaixo"
  return value > benchmark ? "acima" : "abaixo"
}

function BenchmarkChip({ indicator, comparison }: { indicator: Indicator; comparison: BenchmarkComparison }) {
  if (comparison === "indisponivel") {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const isGood = comparison === "acima" ? indicator.higherIsBetter : !indicator.higherIsBetter
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
        isGood ? "bg-ok-muted text-ok" : "bg-risk-muted text-risk",
      )}
    >
      {comparison === "acima" ? "▲ Acima da média" : "▼ Abaixo da média"}
    </span>
  )
}

const STATUS_LABEL: Record<IndicatorStatus, string> = {
  ok: "Adequado",
  atencao: "Atenção",
  risco: "Risco",
  indisponivel: "Sem dados",
}

const STATUS_DOT: Record<IndicatorStatus, string> = {
  ok: "bg-ok",
  atencao: "bg-attention",
  risco: "bg-risk",
  indisponivel: "bg-muted-foreground/40",
}

function StatusBadge({ status }: { status: IndicatorStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={cn("size-2 rounded-full", STATUS_DOT[status])} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

function IndicatorCard({
  indicator,
  lastValue,
  status,
  comparison,
  benchmark,
  exercicioIds,
  ctxByPeriod,
}: {
  indicator: Indicator
  lastValue: number | undefined
  status: IndicatorStatus
  comparison: BenchmarkComparison
  benchmark: number | undefined
  exercicioIds: string[]
  ctxByPeriod: Record<string, IndicatorContext>
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{indicator.name}</p>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{indicator.description}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
          {formatIndicatorValue(indicator, lastValue)}
        </span>
        <BenchmarkChip indicator={indicator} comparison={comparison} />
      </div>
      <details className="group mt-3 border-t border-border pt-2.5">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
          Ver fórmula e histórico
        </summary>
        <div className="mt-2.5 flex flex-col gap-2">
          <code className="block rounded border border-border bg-muted/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {indicator.formula}
          </code>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {exercicioIds.map((id) => (
              <div key={id} className="flex items-center gap-1.5">
                <dt className="text-muted-foreground">{id}</dt>
                <dd className="font-mono tabular-nums text-foreground">
                  {formatIndicatorValue(indicator, indicator.compute(ctxByPeriod[id]))}
                </dd>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <dt className="text-muted-foreground">Média do setor</dt>
              <dd className="font-mono tabular-nums text-foreground">{formatIndicatorValue(indicator, benchmark)}</dd>
            </div>
          </dl>
        </div>
      </details>
    </div>
  )
}

export function IndicesScreen() {
  const store = useFinancialStore()
  const exercicioIds = useMemo(() => store.exercicios.map((e) => e.id), [store.exercicios])
  const lastPeriod = exercicioIds[exercicioIds.length - 1]

  const ctxByPeriod = useMemo(() => {
    const out: Record<string, IndicatorContext> = {}
    for (const id of exercicioIds) {
      out[id] = makeIndicatorContext(store.accounts, computeDre(store.dreByExercicio[id] ?? {}), id)
    }
    return out
  }, [exercicioIds, store.accounts, store.dreByExercicio])

  const groups = useMemo(() => {
    const out: { group: Indicator["group"]; items: Indicator[] }[] = []
    for (const indicator of INDICATORS) {
      const last = out[out.length - 1]
      if (last && last.group === indicator.group) last.items.push(indicator)
      else out.push({ group: indicator.group, items: [indicator] })
    }
    return out
  }, [])

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Análise"
        title="Índices Financeiros"
        subtitle="Indicadores calculados a partir das contas do Plano de Contas, por período, comparados à média do setor."
        actions={
          <>
            <label htmlFor="setor-select" className="text-xs text-muted-foreground">
              Setor
            </label>
            <select
              id="setor-select"
              value={store.sectorId}
              disabled={!can(store.user.papel, "editar-empresa")}
              title={can(store.user.papel, "editar-empresa") ? undefined : "Só coordenadores e administradores alteram o setor"}
              onChange={(e) => store.setSector(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
            >
              {SECTORS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button size="sm" className="h-8 gap-1.5">
              <Plus className="size-3.5" />
              Novo índice
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6 px-8 py-6">
        {groups.map(({ group, items }) => (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{group}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((indicator) => {
                const benchmark = sectorBenchmarkFor(store.sectorId, indicator.id)
                const lastValue = lastPeriod ? indicator.compute(ctxByPeriod[lastPeriod]) : undefined
                const comparison = compareToBenchmark(indicator, lastValue, benchmark)
                const status = indicatorStatus(indicator, lastValue)
                return (
                  <IndicatorCard
                    key={indicator.id}
                    indicator={indicator}
                    lastValue={lastValue}
                    status={status}
                    comparison={comparison}
                    benchmark={benchmark}
                    exercicioIds={exercicioIds}
                    ctxByPeriod={ctxByPeriod}
                  />
                )
              })}
            </div>
          </section>
        ))}

        {/* Dica */}
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Use{" "}
            <code className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
              [Nome da Conta]
            </code>{" "}
            para referenciar contas do Plano de Contas nas fórmulas. Operadores{" "}
            <code className="font-mono text-xs text-foreground">+ − × /</code> e parênteses são suportados. A
            “Média do Setor” é uma referência ilustrativa cadastrada por setor — ajuste em{" "}
            <code className="font-mono text-xs text-foreground">lib/sector-benchmarks.ts</code> conforme a fonte
            disponível.
          </p>
        </div>
      </div>
    </div>
  )
}
