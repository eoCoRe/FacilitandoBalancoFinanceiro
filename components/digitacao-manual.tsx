"use client"

import { useMemo, useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { DocumentoViewer } from "@/components/documento-viewer"
import { Button } from "@/components/ui/button"
import { DRE_LINES, flattenAccounts } from "@/lib/financial-data"
import { dreExtractionTargets, dreLineIdFromCode, toSystemUnit, type DocumentUnit } from "@/lib/extraction/pdf-extraction"
import { parseBrNumber } from "@/lib/number-input"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

// Digitação manual com o documento ao lado: para PDF escaneado, imagem, ou quando a leitura automática não serve.
// O analista digita os valores olhando para o documento; ao confirmar, eles vão para a Tabulação pelo mesmo caminho da
// extração e ficam no histórico como "Digitado pelo analista", com o nome do arquivo (rastreabilidade, RF06).

const DRE_CAMPOS = dreExtractionTargets()
const DEDUCOES = new Set(DRE_LINES.filter((l) => l.deduction).map((l) => l.id))

export function DigitacaoManual({
  file,
  exercicioInicial,
  unidadeInicial,
  valoresIniciais,
  onCancelar,
  onConcluido,
}: {
  file: File
  exercicioInicial: string
  unidadeInicial: DocumentUnit
  // Valores já conhecidos (ex.: o que a leitura automática achou), na unidade do documento, por código de conta.
  valoresIniciais: Record<string, number>
  onCancelar: () => void
  onConcluido: (quantos: number, exercicio: string) => void
}) {
  const store = useFinancialStore()
  const [exercicioId, setExercicioId] = useState(exercicioInicial)
  const [unidade, setUnidade] = useState<DocumentUnit>(unidadeInicial)
  const [textos, setTextos] = useState<Record<string, string>>(() =>
    // Com separador de milhar, como no documento ("2.278.211,52"), para conferir de olho; parseBrNumber lê igual.
    Object.fromEntries(Object.entries(valoresIniciais).map(([code, v]) => [code, v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })])),
  )
  const [salvando, setSalvando] = useState(false)

  const linhasBalanco = useMemo(() => flattenAccounts(store.accounts), [store.accounts])

  const preenchidos = Object.entries(textos).filter(([, t]) => t.trim() !== "")
  const invalidos = preenchidos.filter(([, t]) => parseBrNumber(t) === null).map(([code]) => code)

  async function confirmar() {
    if (salvando || preenchidos.length === 0 || invalidos.length > 0 || !exercicioId) return
    const entries = preenchidos.map(([code, texto]) => {
      let valor = parseBrNumber(texto)!
      // Na DRE, deduções (custo, despesas, IR...) são guardadas negativas: o analista pode digitar sem o sinal.
      const linha = dreLineIdFromCode(code)
      if (linha && DEDUCOES.has(linha)) valor = -Math.abs(valor)
      return { code, value: toSystemUnit(valor, unidade), confidence: 100, label: "Digitado pelo analista" }
    })
    setSalvando(true)
    const ok = await store.confirmExtraction(exercicioId, entries, file.name, "digitacao-manual")
    setSalvando(false)
    // Se o servidor recusou, o motivo aparece no aviso global e o que foi digitado continua na tela.
    if (ok) onConcluido(entries.length, exercicioId)
  }

  const campo = (code: string, nome: string, recuo = 0, dica?: string) => {
    const texto = textos[code] ?? ""
    const invalido = texto.trim() !== "" && parseBrNumber(texto) === null
    return (
      <label key={code} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-0" style={{ paddingLeft: 12 + recuo }}>
        <span className="min-w-0 flex-1 text-sm text-foreground">
          {nome}
          {dica && <span className="ml-1 text-[11px] text-muted-foreground">{dica}</span>}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTextos((t) => ({ ...t, [code]: e.target.value }))}
          placeholder="—"
          aria-invalid={invalido}
          aria-label={nome}
          className={cn(
            "w-36 rounded border bg-background px-2 py-1 text-right font-mono text-sm tabular-nums text-foreground outline-none focus:border-ring",
            invalido ? "border-risk" : "border-border",
          )}
        />
      </label>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)] h-[60vh]">
        <DocumentoViewer file={file} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-4 py-3">
          <label htmlFor="dm-unidade" className="text-xs text-muted-foreground">
            Valores do documento em
          </label>
          <select
            id="dm-unidade"
            value={unidade}
            onChange={(e) => setUnidade(e.target.value as DocumentUnit)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            <option value="reais">Reais (R$)</option>
            <option value="milhares">Milhares (R$ mil)</option>
          </select>
          <label htmlFor="dm-exercicio" className="text-xs text-muted-foreground">
            Gravar em
          </label>
          <select
            id="dm-exercicio"
            value={exercicioId}
            onChange={(e) => setExercicioId(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
          >
            {store.exercicios.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Digite os valores como estão no documento (ex.: 12.663.067,45). Campos em branco não mudam o que já está lançado
          na Tabulação; os preenchidos substituem. Na DRE, as deduções podem ser digitadas sem o sinal de menos.
        </p>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <h2 className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Balanço Patrimonial
          </h2>
          {linhasBalanco.map(({ account, depth }) =>
            account.children ? (
              <p
                key={account.code}
                className="border-b border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground"
                style={{ paddingLeft: 12 + depth * 14 }}
              >
                {account.code} {account.name}
              </p>
            ) : (
              campo(account.code, `${account.code} ${account.name}`, depth * 14)
            ),
          )}
        </section>

        <section className="overflow-hidden rounded-md border border-border bg-card">
          <h2 className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            DRE
          </h2>
          {DRE_CAMPOS.map((linha) => campo(linha.code, linha.name, 0, linha.code === "dre:compras" ? "(informativo, usado no PMPC)" : undefined))}
        </section>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {invalidos.length > 0
              ? `${invalidos.length} campo(s) com valor inválido`
              : `${preenchidos.length} campo(s) preenchido(s)`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onCancelar} disabled={salvando}>
              <X className="size-3.5" />
              Voltar
            </Button>
            <Button size="sm" className="gap-1.5" onClick={confirmar} disabled={salvando || preenchidos.length === 0 || invalidos.length > 0 || !exercicioId}>
              {salvando ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Gravar {preenchidos.length} valor(es) em {exercicioId || "—"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
