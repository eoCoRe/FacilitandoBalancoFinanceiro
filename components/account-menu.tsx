"use client"

import { useState, type FormEvent } from "react"
import { KeyRound, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TwoFactorSection } from "@/components/two-factor-section"
import { api, errorMessage } from "@/lib/api-client"
import { PAPEL_LABEL } from "@/lib/permissions"
import { useFinancialStore } from "@/lib/store"

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?"
}

// Rodapé da sidebar: quem está logado, troca de senha e saída.
export function AccountMenu() {
  const { user } = useFinancialStore()
  const [changing, setChanging] = useState(false)
  const [senhaAtual, setSenhaAtual] = useState("")
  const [novaSenha, setNovaSenha] = useState("")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleLogout() {
    try {
      await api("/api/auth/logout", { method: "POST", redirectOn401: false })
    } finally {
      // Navegação completa de propósito: descarta o estado em memória (dados do usuário).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login")
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await api("/api/auth/senha", { method: "POST", body: { senhaAtual, novaSenha }, redirectOn401: false })
      setMessage({ ok: true, text: "Senha alterada." })
      setSenhaAtual("")
      setNovaSenha("")
      setChanging(false)
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-auto border-t border-border p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/90 text-xs font-medium text-primary-foreground">
          {initials(user.nome)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={user.email}>
            {user.nome}
          </p>
          <p className="truncate text-xs text-muted-foreground">{PAPEL_LABEL[user.papel]}</p>
        </div>
      </div>

      <TwoFactorSection />

      {changing && (
        <form onSubmit={handleChangePassword} className="mt-3 flex flex-col gap-2">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Senha atual"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Nova senha (mín. 10 caracteres)"
            required
            minLength={10}
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} className="flex-1">
              Salvar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setChanging(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {message && (
        <p role="status" className={message.ok ? "mt-2 text-xs text-ok" : "mt-2 text-xs text-destructive"}>
          {message.text}
        </p>
      )}

      {!changing && (
        <div className="mt-3 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="flex-1 justify-start"
            onClick={() => {
              setMessage(null)
              setChanging(true)
            }}
          >
            <KeyRound />
            Senha
          </Button>
          <Button type="button" size="sm" variant="ghost" className="flex-1 justify-start" onClick={handleLogout}>
            <LogOut />
            Sair
          </Button>
        </div>
      )}
    </div>
  )
}
