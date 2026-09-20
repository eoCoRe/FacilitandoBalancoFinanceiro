"use client"

import { useCallback, useEffect, useState, type FormEvent } from "react"
import { AlertTriangle, KeyRound, Loader2, Plus } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { PAPEIS, PAPEL_LABEL, type Papel } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface Usuario {
  id: number
  nome: string
  email: string
  papel: Papel
  ativo: boolean
  temSenha: boolean
  temGoogle: boolean
  ultimoLoginEm: string | null
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca"
}

const inputClass =
  "rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-ring"

export function UsuariosScreen() {
  const { user: me } = useFinancialStore()
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ nome: "", email: "", papel: "ANALISTA" as Papel, senha: "" })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { usuarios } = await api<{ usuarios: Usuario[] }>("/api/usuarios")
      setUsuarios(usuarios)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api<{ usuarios: Usuario[] }>("/api/usuarios")
      .then((data) => {
        if (!cancelled) setUsuarios(data.usuarios)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Todas as alterações passam pelo servidor, que é quem valida (não rebaixar a si mesmo,
  // não remover o último administrador...). A tela só mostra o motivo da recusa.
  async function update(id: number, body: Record<string, unknown>) {
    setError(null)
    try {
      await api(`/api/usuarios/${id}`, { method: "PATCH", body })
      await load()
    } catch (err) {
      setError(errorMessage(err))
      await load()
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api("/api/usuarios", {
        method: "POST",
        body: { nome: form.nome, email: form.email, papel: form.papel, senha: form.senha || undefined },
      })
      setForm({ nome: "", email: "", papel: "ANALISTA", senha: "" })
      setCreating(false)
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function handleResetPassword(u: Usuario) {
    const senha = window.prompt(`Nova senha para ${u.nome} (mínimo 10 caracteres). As sessões abertas dessa pessoa serão encerradas.`)
    if (senha) void update(u.id, { senha })
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Administração"
        title="Usuários"
        subtitle="Quem pode acessar o sistema e com qual perfil. Não há auto-cadastro: só administradores criam acessos."
        actions={
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-3.5" />
            Novo usuário
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-8 py-6">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {creating && (
          <form onSubmit={handleCreate} className="grid gap-3 rounded-md border border-border bg-card p-4 md:grid-cols-4">
            <input
              required
              placeholder="Nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              className={inputClass}
            />
            <input
              required
              type="email"
              placeholder="E-mail"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
            <select
              value={form.papel}
              onChange={(e) => setForm({ ...form, papel: e.target.value as Papel })}
              className={inputClass}
              aria-label="Perfil"
            >
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {PAPEL_LABEL[p]}
                </option>
              ))}
            </select>
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Senha (opcional se entrar pelo Google)"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              className={inputClass}
            />
            <div className="flex gap-2 md:col-span-4">
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                Criar usuário
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {usuarios === null && !error ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            Carregando usuários…
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Perfil</th>
                  <th className="px-4 py-3">Acesso</th>
                  <th className="px-4 py-3">Último login</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(usuarios ?? []).map((u) => {
                  const isMe = u.id === me.id
                  return (
                    <tr key={u.id} className={cn("border-b border-border last:border-0", !u.ativo && "opacity-60")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">
                          {u.nome}
                          {isMe && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.papel}
                          disabled={isMe}
                          title={isMe ? "Você não pode alterar o seu próprio perfil" : undefined}
                          aria-label={`Perfil de ${u.nome}`}
                          onChange={(e) => void update(u.id, { papel: e.target.value })}
                          className={cn(inputClass, "py-1")}
                        >
                          {PAPEIS.map((p) => (
                            <option key={p} value={p}>
                              {PAPEL_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {[u.temSenha && "Senha", u.temGoogle && "Google"].filter(Boolean).join(" · ") || "Nenhum ainda"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(u.ultimoLoginEm)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            u.ativo ? "bg-ok-muted text-ok" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {u.ativo ? "Ativo" : "Desativado"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <Button type="button" size="sm" variant="outline" onClick={() => handleResetPassword(u)}>
                            <KeyRound />
                            Redefinir senha
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={u.ativo ? "destructive" : "outline"}
                            disabled={isMe && u.ativo}
                            title={isMe && u.ativo ? "Você não pode desativar a si mesmo" : undefined}
                            onClick={() => void update(u.id, { ativo: !u.ativo })}
                          >
                            {u.ativo ? "Desativar" : "Reativar"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
