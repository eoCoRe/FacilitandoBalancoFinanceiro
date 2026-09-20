"use client"

import { useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, Download, Loader2, Search } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { can } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Registro {
  id: number
  usuario: string
  acao: string
  detalhe: string
  criadoEm: string
}

interface Pagina {
  logs: Registro[]
  proximoCursor: number | null
  acoes?: string[]
}

interface Filtros {
  usuario: string
  acao: string
  de: string // yyyy-mm-dd (dia local)
  ate: string
  q: string
}

const SEM_FILTROS: Filtros = { usuario: "", acao: "", de: "", ate: "", q: "" }

// Filtros -> query string. As datas são dias no fuso do usuário: início do dia inicial e fim do dia final.
function toQuery(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (f.usuario.trim()) p.set("usuario", f.usuario.trim())
  if (f.acao) p.set("acao", f.acao)
  if (f.q.trim()) p.set("q", f.q.trim())
  if (f.de) p.set("de", new Date(`${f.de}T00:00:00`).toISOString())
  if (f.ate) p.set("ate", new Date(`${f.ate}T23:59:59.999`).toISOString())
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  return p.toString()
}

const fetchPage = (f: Filtros, extra: Record<string, string> = {}) => api<Pagina>(`/api/auditoria?${toQuery(f, extra)}`)

const inputClass =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-ring"

export function AuditoriaScreen() {
  const { user } = useFinancialStore()
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTROS)
  const [aplicados, setAplicados] = useState<Filtros>(SEM_FILTROS)
  const [registros, setRegistros] = useState<Registro[] | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [acoes, setAcoes] = useState<string[]>([])
  const [carregando, setCarregando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchPage(SEM_FILTROS, { opcoes: "1" })
      .then((pagina) => {
        if (cancelled) return
        setRegistros(pagina.logs)
        setCursor(pagina.proximoCursor)
        setAcoes(pagina.acoes ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function filtrar(event: FormEvent) {
    event.preventDefault()
    if (carregando) return
    setCarregando(true)
    setError(null)
    try {
      // Pede também as ações existentes: podem ter surgido novas (ex.: "Auditoria exportada") desde a abertura.
      const pagina = await fetchPage(filtros, { opcoes: "1" })
      setAplicados(filtros)
      setRegistros(pagina.logs)
      setCursor(pagina.proximoCursor)
      if (pagina.acoes) setAcoes(pagina.acoes)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCarregando(false)
    }
  }

  async function carregarMais() {
    if (carregando || cursor === null) return
    setCarregando(true)
    setError(null)
    try {
      const pagina = await fetchPage(aplicados, { cursor: String(cursor) })
      setRegistros((prev) => [...(prev ?? []), ...pagina.logs])
      setCursor(pagina.proximoCursor)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCarregando(false)
    }
  }

  function limpar() {
    setFiltros(SEM_FILTROS)
  }

  const podeExportar = can(user.papel, "exportar-auditoria")

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Rastreabilidade"
        title="Auditoria"
        subtitle="Quem fez o quê e quando: lançamentos, alterações no plano de contas, acessos e ações administrativas."
        actions={
          podeExportar ? (
            // Download por navegação: o cookie de sessão vai junto e o servidor confere a permissão.
            <a
              href={`/api/auditoria/exportar?${toQuery(aplicados)}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-1.5")}
            >
              <Download className="size-3.5" />
              Exportar CSV
            </a>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4 px-8 py-6">
        <form onSubmit={filtrar} className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-6">
          <input
            placeholder="Usuário (e-mail)"
            aria-label="Filtrar por usuário"
            value={filtros.usuario}
            onChange={(e) => setFiltros({ ...filtros, usuario: e.target.value })}
            className={inputClass}
          />
          <select
            aria-label="Filtrar por ação"
            value={filtros.acao}
            onChange={(e) => setFiltros({ ...filtros, acao: e.target.value })}
            className={inputClass}
          >
            <option value="">Todas as ações</option>
            {acoes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="Data inicial"
            value={filtros.de}
            onChange={(e) => setFiltros({ ...filtros, de: e.target.value })}
            className={inputClass}
          />
          <input
            type="date"
            aria-label="Data final"
            value={filtros.ate}
            onChange={(e) => setFiltros({ ...filtros, ate: e.target.value })}
            className={inputClass}
          />
          <input
            placeholder="Buscar no detalhe…"
            aria-label="Buscar no texto"
            value={filtros.q}
            onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={carregando} className="flex-1 gap-1.5">
              {carregando ? <Loader2 className="animate-spin" /> : <Search />}
              Filtrar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={limpar}>
              Limpar
            </Button>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {registros === null && !error ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            Carregando a auditoria…
          </div>
        ) : registros !== null && registros.length === 0 ? (
          <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum registro encontrado com estes filtros.
          </p>
        ) : (
          registros !== null && (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-3">Data e hora</th>
                    <th className="px-3 py-3">Usuário</th>
                    <th className="px-3 py-3">Ação</th>
                    <th className="px-3 py-3">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={r.id} className="border-b border-border align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-muted-foreground">
                        {new Date(r.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}
                      </td>
                      <td className="px-3 py-2.5 text-xs">{r.usuario}</td>
                      <td className="px-3 py-2.5 font-medium text-foreground">{r.acao}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.detalhe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {cursor !== null && (
          <div className="flex justify-center">
            <Button type="button" variant="outline" size="sm" disabled={carregando} onClick={carregarMais}>
              {carregando && <Loader2 className="animate-spin" />}
              Carregar mais
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
