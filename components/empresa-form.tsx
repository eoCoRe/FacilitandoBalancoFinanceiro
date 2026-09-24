"use client"

import { useState, type FormEvent } from "react"
import { Building2, Loader2 } from "lucide-react"
import { AuthMessage, authInputClass } from "@/components/auth/auth-shell"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj"
import { SECTORS } from "@/lib/sector-benchmarks"

// Cadastro de uma empresa (POST /api/empresa). O servidor já deixa a empresa nova escolhida (cookie); quem usa o
// formulário só precisa recarregar os dados em `onCreated`. Usado na primeira empresa (EmpresaOnboarding) e no seletor
// de empresa da barra lateral.
export function EmpresaForm({ onCreated, submitLabel = "Cadastrar empresa" }: { onCreated: () => void; submitLabel?: string }) {
  const [cnpj, setCnpj] = useState("")
  const [razaoSocial, setRazaoSocial] = useState("")
  const [setor, setSetor] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!isValidCnpj(cnpj)) {
      setError("CNPJ inválido. Confira os 14 dígitos.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api("/api/empresa", { method: "POST", body: { cnpj, razaoSocial, ...(setor ? { setor } : {}) }, redirectOn401: false })
      onCreated()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error && <AuthMessage kind="error">{error}</AuthMessage>}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        CNPJ
        <input
          inputMode="numeric"
          autoComplete="off"
          required
          autoFocus
          value={cnpj}
          onChange={(e) => setCnpj(onlyDigits(e.target.value).length === 14 ? formatCnpj(e.target.value) : e.target.value)}
          className={authInputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Razão social
        <input required maxLength={200} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} className={authInputClass} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Setor
        <select value={setor} onChange={(e) => setSetor(e.target.value)} className={authInputClass}>
          <option value="">Padrão ({SECTORS[0].label})</option>
          {SECTORS.map((s) => (
            <option key={s.id} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
        {submitLabel}
      </Button>
    </form>
  )
}
