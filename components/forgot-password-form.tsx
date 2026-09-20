"use client"

import { useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { AuthMessage, AuthShell, authInputClass, authLinkClass } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await api<{ mensagem: string }>("/api/auth/recuperar-senha", {
        method: "POST",
        body: { email },
        redirectOn401: false,
      })
      setSent(result.mensagem)
    } catch (err) {
      setError(errorMessage(err))
      setTimeout(() => emailRef.current?.focus(), 0) // o botão desabilitado tirou o foco
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell title="Esqueci minha senha" subtitle="Informe o e-mail do seu acesso e enviaremos um link para criar uma nova senha.">
      {sent ? (
        <AuthMessage kind="success">{sent}</AuthMessage>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <AuthMessage kind="error">{error}</AuthMessage>}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            E-mail
            <input
              type="email"
              autoComplete="username"
              required
              autoFocus
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authInputClass}
            />
          </label>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Enviar link
          </Button>
        </form>
      )}
      <Link href="/login" className={authLinkClass}>
        Voltar para o login
      </Link>
    </AuthShell>
  )
}
