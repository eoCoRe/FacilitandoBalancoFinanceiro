"use client"

import { useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { AuthMessage, AuthShell, authInputClass, authLinkClass } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [novaSenha, setNovaSenha] = useState("")
  const [confirmacao, setConfirmacao] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const senhaRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (novaSenha !== confirmacao) {
      setError("As senhas não conferem.")
      senhaRef.current?.focus()
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api("/api/auth/redefinir-senha", { method: "POST", body: { token, novaSenha }, redirectOn401: false })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
      setTimeout(() => senhaRef.current?.focus(), 0) // o botão desabilitado tirou o foco
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma nova senha para o seu acesso (mínimo de 10 caracteres).">
      {!token ? (
        <AuthMessage kind="error">Link inválido. Peça uma nova recuperação de senha.</AuthMessage>
      ) : done ? (
        <AuthMessage kind="success">Senha alterada. Você já pode entrar com a nova senha.</AuthMessage>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Nova senha
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              autoFocus
              ref={senhaRef}
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              className={authInputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Repita a nova senha
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className={authInputClass}
            />
          </label>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Salvar nova senha
          </Button>
        </form>
      )}
      {/* Link vencido, usado ou ausente: o caminho natural é pedir outro. */}
      {(!token || error?.startsWith("Link inválido")) && (
        <Link href="/esqueci-senha" className={authLinkClass}>
          Pedir um novo link
        </Link>
      )}
      <Link href="/login" className={authLinkClass}>
        Ir para o login
      </Link>
    </AuthShell>
  )
}
