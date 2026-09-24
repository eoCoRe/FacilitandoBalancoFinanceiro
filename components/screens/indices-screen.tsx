"use client"

import { useMemo } from "react"
import { ChevronDown, Download, Info, Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { downloadTextFile } from "@/lib/download"
import { exportFileName, indicesCsv } from "@/lib/export-csv"
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
import { BENCHMARK_SOURCE, sectorBenchmarkFor, sectorBenchmarkSample, sectorCompanies, sectorLabel, SECTORS } from "@/lib/sector-benchmarks"
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
  benchmarkSample,
  exercicioIds,
  ctxByPeriod,
}: {
  indicator: Indicator
  lastValue: number | undefined
  status: IndicatorStatus
  comparison: BenchmarkComparison
  benchmark: number | undefined
  benchmarkSample: number
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
              <dt className="text-muted-foreground">Mediana do setor</dt>
              <dd className="font-mono tabular-nums text-foreground">
                {benchmark === undefined ? (
                  <span title="A fonte (DFP da CVM) não traz os dados deste índice">sem referência</span>
                ) : (
                  <span title={`Mediana de ${benchmarkSample} companhias abertas do setor (CVM, DFP ${BENCHMARK_SOURCE.exercicio})`}>
                    {formatIndicatorValue(indicator, benchmark)}
                  </span>
                )}
              </dd>
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
        subtitle="Indicadores calculados a partir das contas do Plano de Contas, por período, comparados à mediana do setor (companhias abertas, CVM)."
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
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() =>
                downloadTextFile(
                  exportFileName("indices", store.companyName),
                  indicesCsv(store.accounts, store.dreByExercicio, exercicioIds),
                )
              }
            >
              <Download className="size-3.5" />
              Exportar CSV
            </Button>
            {/* Índices personalizados ainda não existem: em vez de um botão que não faz nada, fica desabilitado e diz o motivo. */}
            <Button size="sm" className="h-8 gap-1.5" disabled title="Em breve: por enquanto o catálogo de índices é fixo">
              <Plus className="size-3.5" />
              Novo índice
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-6 px-4 md:px-8 py-6">
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
                    benchmarkSample={sectorBenchmarkSample(store.sectorId, indicator.id)}
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
            <code className="font-mono text-xs text-foreground">+ − × /</code> e parênteses são suportados.
          </p>
        </div>

        {/* Fonte das referências setoriais */}
        <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Mediana do setor</strong>: mediana de cada índice entre as{" "}
            {sectorCompanies(store.sectorId)} companhias abertas do setor {sectorLabel(store.sectorId)}, calculada a partir das
            demonstrações do exercício {BENCHMARK_SOURCE.exercicio} publicadas pela{" "}
            <a href={BENCHMARK_SOURCE.url} target="_blank" rel="noreferrer" className="text-primary-text underline underline-offset-2">
              CVM (Dados Abertos, DFP)
            </a>
            . São empresas maiores que o cliente típico de crédito: use como referência de ordem de grandeza, não como meta. O
            PMRV usa a receita líquida (a DFP não traz a bruta) e o PMPC não tem referência (a DFP não traz as compras).
          </p>
        </div>
      </div>
    </div>
  )
}
