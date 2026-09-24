"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { History, Loader2, Stamp } from "lucide-react"
import { AuthMessage } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { formatBRL, RATING_LABEL, type OpinionRating, type SalesOpinion } from "@/lib/financial-data"
import { DECISAO_LABEL, DECISOES, type Decisao, type ParecerRegistrado } from "@/lib/parecer"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

// Registro da decisão de crédito e histórico dos pareceres registrados (app/api/pareceres). A análise automática que
// vai junto é recalculada no servidor; aqui só se escolhe a decisão, o limite, a validade e a justificativa.

const DECISAO_SUGERIDA: Record<OpinionRating, Decisao> = {
  favoravel: "APROVADO",
  ressalvas: "APROVADO_COM_RESSALVAS",
  desfavoravel: "REPROVADO",
}

const DECISAO_ESTILO: Record<Decisao, string> = {
  APROVADO: "border-ok/40 bg-ok-muted text-ok",
  APROVADO_COM_RESSALVAS: "border-attention/40 bg-attention-muted text-attention",
  REPROVADO: "border-risk/40 bg-risk-muted text-risk",
}

// Máscara de moeda: os dígitos digitados são centavos ("123456" → 1.234,56).
function parseCurrency(raw: string): number {
  const digits = raw.replace(/\D/g, "")
  return digits ? Number(digits) / 100 : 0
}

function daquiAUmAno(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().slice(0, 10)
}

const formatData = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR")

export function RegistrarDecisao({
  exercicioId,
  opinion,
  onRegistrado,
}: {
  exercicioId: string
  opinion: SalesOpinion
  onRegistrado: (parecer: ParecerRegistrado) => void
}) {
  const store = useFinancialStore()
  const sugerida = DECISAO_SUGERIDA[opinion.rating]
  const [decisao, setDecisao] = useState<Decisao>(sugerida)
  const limiteInicial = opinion.limitAvailable ? Math.min(opinion.requestedValue, opinion.suggestedLimit) : opinion.requestedValue
  const [limite, setLimite] = useState(Math.round(limiteInicial * 100) / 100)
  const [validade, setValidade] = useState(daquiAUmAno())
  const [justificativa, setJustificativa] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const reprovado = decisao === "REPROVADO"

  async function registrar(event: FormEvent) {
    event.preventDefault()
    if (salvando) return
    if (opinion.requestedValue <= 0) return setErro("Informe o valor da solicitação acima.")
    if (!reprovado && limite <= 0) return setErro("Informe o limite aprovado.")
    if (justificativa.trim().length < 10) return setErro("Escreva a justificativa (pelo menos 10 caracteres).")
    setErro(null)
    setSalvando(true)
    const parecer = await store.registrarParecer(exercicioId, {
      valorSolicitado: opinion.requestedValue,
      decisao,
      limiteAprovado: reprovado ? null : limite,
      validadeAte: reprovado || !validade ? null : validade,
      justificativa: justificativa.trim(),
    })
    setSalvando(false)
    // Se o servidor recusou, o motivo aparece no aviso global e o formulário continua preenchido.
    if (!parecer) return
    setJustificativa("")
    onRegistrado(parecer)
  }

  return (
    <section className="rounded-md border border-border bg-card p-5 print:hidden">
      <div className="mb-3 flex items-center gap-2">
        <Stamp className="size-4 text-muted-foreground" />
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Registrar decisão</h2>
      </div>
      <form onSubmit={registrar} className="flex flex-col gap-3">
        {erro && <AuthMessage kind="error">{erro}</AuthMessage>}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-muted-foreground">
            Decisão <span className="text-muted-foreground/80">(sugerida pela análise: {DECISAO_LABEL[sugerida]})</span>
          </legend>
          {DECISOES.map((d) => (
            <label
              key={d}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                decisao === d ? DECISAO_ESTILO[d] : "border-border text-foreground hover:bg-accent",
              )}
            >
              <input type="radio" name="decisao" value={d} checked={decisao === d} onChange={() => setDecisao(d)} className="sr-only" />
              {DECISAO_LABEL[d]}
            </label>
          ))}
        </fieldset>
        {!reprovado && (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Limite aprovado
              <span className="flex items-center rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
                <span className="pl-3 pr-1 text-sm font-medium">R$</span>
                <input
                  inputMode="numeric"
                  value={limite > 0 ? formatBRL(limite, 2) : ""}
                  onChange={(e) => setLimite(parseCurrency(e.target.value))}
                  placeholder="0,00"
                  className="w-full bg-transparent py-1.5 pr-3 text-right font-mono text-sm tabular-nums text-foreground outline-none"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Válido até
              <input
                type="date"
                value={validade}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setValidade(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Justificativa
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Por que esta decisão? Condições, garantias, pontos de atenção…"
            className="resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
          />
        </label>
        <Button type="submit" size="sm" disabled={salvando} className="gap-1.5">
          {salvando ? <Loader2 className="size-3.5 animate-spin" /> : <Stamp className="size-3.5" />}
          Registrar parecer para {exercicioId}
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O parecer registrado não pode ser editado nem apagado: uma nova decisão entra como outro parecer. Fica na trilha
          de auditoria, com a análise automática deste momento.
        </p>
      </form>
    </section>
  )
}

export function HistoricoPareceres({ recarregar }: { recarregar: number }) {
  const [pareceres, setPareceres] = useState<ParecerRegistrado[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(() => {
    let cancelado = false
    api<{ pareceres: ParecerRegistrado[] }>("/api/pareceres")
      .then((r) => !cancelado && setPareceres(r.pareceres))
      .catch((e) => !cancelado && setErro(errorMessage(e)))
    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => carregar(), [carregar, recarregar])

  const hoje = new Date().toISOString().slice(0, 10)

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Histórico de pareceres</h2>
      </div>
      {erro ? (
        <AuthMessage kind="error">{erro}</AuthMessage>
      ) : pareceres === null ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando…
        </p>
      ) : pareceres.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum parecer registrado para esta empresa ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pareceres.map((p) => {
            const vencido = p.validadeAte !== null && p.validadeAte < hoje
            return (
              <li key={p.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={cn("rounded border px-2 py-0.5 text-xs font-medium", DECISAO_ESTILO[p.decisao])}>
                    {DECISAO_LABEL[p.decisao]}
                    {p.limiteAprovado !== null && ` · R$ ${formatBRL(p.limiteAprovado, 2)}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(p.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {p.registradoPor}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90 text-pretty">{p.justificativa}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Exercício {p.exercicio} · solicitado R$ {formatBRL(p.valorSolicitado, 2)} · análise automática:{" "}
                  {RATING_LABEL[p.classificacao]} (score {p.score})
                  {p.limiteSugerido !== null && ` · limite sugerido R$ ${formatBRL(p.limiteSugerido, 2)}`}
                  {p.validadeAte !== null && (
                    <span className={cn(vencido && "font-medium text-risk")}>
                      {" "}
                      · válido até {formatData(p.validadeAte)}
                      {vencido && " (vencido)"}
                    </span>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
