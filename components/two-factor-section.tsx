"use client"

import { useState, type FormEvent } from "react"
import { ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { useFinancialStore } from "@/lib/store"

const inputClass =
  "rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"

type Step = "idle" | "codigo" | "desligar"

// Liga/desliga a verificação em 2 etapas por e-mail, no rodapé da barra lateral. Ligar exige
// digitar o código que chega no e-mail (prova que a caixa recebe mensagens, para ninguém se
// trancar); desligar exige a senha e é negado se o perfil for obrigado a usar.
export function TwoFactorSection() {
  const { user } = useFinancialStore()
  const [ativo, setAtivo] = useState(user.doisFatoresAtivo)
  const [step, setStep] = useState<Step>("idle")
  const [valor, setValor] = useState("")
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Perfil obrigado: o 2FA vale mesmo com a chave pessoal desligada.
  const obrigatorio = user.doisFatoresObrigatorio

  async function run(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  function startEnable() {
    void run(async () => {
      await api("/api/auth/2fa/ativar", { method: "POST", redirectOn401: false })
      setValor("")
      setStep("codigo")
      setMessage({ ok: true, text: "Enviamos um código para o seu e-mail." })
    })
  }

  function confirmEnable(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api("/api/auth/2fa/confirmar", { method: "POST", body: { codigo: valor }, redirectOn401: false })
      setAtivo(true)
      setStep("idle")
      setValor("")
      setMessage({ ok: true, text: "Verificação em 2 etapas ligada." })
    })
  }

  function confirmDisable(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      await api("/api/auth/2fa/desativar", { method: "POST", body: { senha: valor }, redirectOn401: false })
      setAtivo(false)
      setStep("idle")
      setValor("")
      setMessage({ ok: true, text: "Verificação em 2 etapas desligada." })
    })
  }

  function cancel() {
    setStep("idle")
    setValor("")
    setMessage(null)
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        <span className="flex-1">
          2 etapas: <strong className="font-medium text-foreground">{ativo || obrigatorio ? "ligada" : "desligada"}</strong>
          {obrigatorio && " (exigida pelo seu perfil)"}
        </span>
      </div>

      {step === "idle" && !obrigatorio && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          className="mt-1.5 w-full justify-start"
          onClick={ativo ? () => { setMessage(null); setValor(""); setStep("desligar") } : startEnable}
        >
          {ativo ? "Desligar 2 etapas" : "Ligar 2 etapas"}
        </Button>
      )}

      {step === "codigo" && (
        <form onSubmit={confirmEnable} className="mt-2 flex flex-col gap-2">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="Código de 6 dígitos"
            maxLength={7}
            required
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} className="flex-1">
              Confirmar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {step === "desligar" && (
        <form onSubmit={confirmDisable} className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Sua senha para confirmar"
            required
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} className="flex-1">
              Desligar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={cancel}>
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
    </div>
  )
}
