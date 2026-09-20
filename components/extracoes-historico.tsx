"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { api, errorMessage } from "@/lib/api-client"
import { formatBRL } from "@/lib/financial-data"

interface ResumoExtracao {
  id: number
  arquivoOrigem: string
  modeloLlm: string
  status: string
  criadoEm: string
  exercicio: string
  totalItens: number
  mapeados: number
  naoMapeados: number
}

interface ItemExtraido {
  id: number
  rotulo: string | null
  valor: number
  pagina: number | null
  confianca: number
  conta: { codigo: string; descricao: string } | null
}

interface DetalheExtracao {
  itens: ItemExtraido[]
}

// Nome legível do que produziu a extração (o campo do banco guarda um identificador técnico).
function origemLegivel(modelo: string): string {
  return modelo === "leitor-pdf-local" ? "Leitor local de PDF" : modelo
}

const formatarData = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })

// Histórico de extrações (RF06): para cada documento processado, o que foi lido, de onde (página e texto
// original), com que confiança e a que conta foi ligado — inclusive as linhas que ficaram SEM conta.
// `refreshKey` muda quando uma nova extração é confirmada, para a lista recarregar.
export function ExtracoesHistorico({ refreshKey }: { refreshKey: number }) {
  const [extracoes, setExtracoes] = useState<ResumoExtracao[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [detalhes, setDetalhes] = useState<Record<number, ItemExtraido[] | "erro">>({})

  useEffect(() => {
    let cancelled = false
    api<{ extracoes: ResumoExtracao[] }>("/api/extracoes")
      .then((data) => {
        if (!cancelled) setExtracoes(data.extracoes)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  async function alternar(id: number) {
    if (aberta === id) {
      setAberta(null)
      return
    }
    setAberta(id)
    if (detalhes[id]) return
    try {
      const data = await api<DetalheExtracao>(`/api/extracoes/${id}`)
      setDetalhes((prev) => ({ ...prev, [id]: data.itens }))
    } catch {
      setDetalhes((prev) => ({ ...prev, [id]: "erro" }))
    }
  }

  return (
    <section className="mt-2 flex flex-col gap-3" aria-labelledby="historico-extracoes">
      <h2 id="historico-extracoes" className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        Extrações recentes
      </h2>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {extracoes === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          Carregando o histórico…
        </div>
      ) : extracoes !== null && extracoes.length === 0 ? (
        <p className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Nenhuma extração confirmada ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {extracoes?.map((e) => {
            const aberto = aberta === e.id
            const itens = detalhes[e.id]
            return (
              <li key={e.id} className="rounded-md border border-border bg-card">
                <button
                  type="button"
                  onClick={() => void alternar(e.id)}
                  aria-expanded={aberto}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm"
                >
                  {aberto ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{e.arquivoOrigem}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatarData(e.criadoEm)} · exercício {e.exercicio} · {origemLegivel(e.modeloLlm)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {e.mapeados} lançado(s)
                    {e.naoMapeados > 0 && <> · {e.naoMapeados} sem conta</>}
                  </span>
                </button>

                {aberto && (
                  <div className="border-t border-border px-4 py-3">
                    {itens === undefined ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                        <Loader2 className="size-4 animate-spin" />
                        Carregando os itens…
                      </div>
                    ) : itens === "erro" ? (
                      <p className="text-sm text-destructive">Não foi possível carregar os itens desta extração.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                              <th className="py-2 pr-3">Texto lido no documento</th>
                              <th className="py-2 pr-3">Conta</th>
                              <th className="py-2 pr-3 text-right">Valor</th>
                              <th className="py-2 pr-3 text-right">Página</th>
                              <th className="py-2 text-right">Confiança</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itens.map((item) => (
                              <tr key={item.id} className="border-t border-border/60">
                                <td className="py-2 pr-3">{item.rotulo ?? <span className="text-muted-foreground">—</span>}</td>
                                <td className="py-2 pr-3">
                                  {item.conta ? (
                                    <>
                                      <span className="font-mono text-xs text-muted-foreground">{item.conta.codigo}</span>{" "}
                                      {item.conta.descricao}
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground">Sem conta (não lançado)</span>
                                  )}
                                </td>
                                <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{formatBRL(item.valor, 0)}</td>
                                <td className="py-2 pr-3 text-right text-muted-foreground">{item.pagina ?? "—"}</td>
                                <td className="py-2 text-right text-muted-foreground">{Math.round(item.confianca)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
