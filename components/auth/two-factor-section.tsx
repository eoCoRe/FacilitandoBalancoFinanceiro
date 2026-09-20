"use client"

import { useEffect, useState, type FormEvent } from "react"
import { ShieldCheck, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, errorMessage } from "@/lib/api-client"
import { downloadTextFile } from "@/lib/download"
import { useFinancialStore } from "@/lib/store"

const inputClass =
  "rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-ring"

type Step = "idle" | "codigo" | "desligar" | "app-senha" | "app-codigo" | "app-guardar"
type AppAcao = "iniciar" | "desligar" | "codigos"

const APP_SENHA_TEXTO: Record<AppAcao, { botao: string; ajuda: string }> = {
  iniciar: { botao: "Continuar", ajuda: "Confirme a sua senha para cadastrar o aplicativo." },
  desligar: { botao: "Desligar", ajuda: "Confirme a sua senha para desligar o aplicativo." },
  codigos: { botao: "Gerar novos", ajuda: "Confirme a sua senha. Os códigos antigos deixam de valer." },
}

// Verificação em 2 etapas, no rodapé da barra lateral, com dois fatores independentes:
// - código por e-mail: ligar exige digitar o código que chega no e-mail (prova que a caixa recebe
//   mensagens, para ninguém se trancar);
// - aplicativo autenticador (TOTP): ligar exige a senha e um primeiro código do app; gera códigos de
//   recuperação, mostrados uma única vez.
// Desligar qualquer um exige a senha e é negado se o perfil for obrigado a usar 2 etapas e o outro
// fator não estiver ligado. Com o app ligado, é ele que o login pede.
export function TwoFactorSection() {
  const { user } = useFinancialStore()
  const [ativo, setAtivo] = useState(user.doisFatoresAtivo)
  const [appAtivo, setAppAtivo] = useState(user.totpAtivo)
  const [step, setStep] = useState<Step>("idle")
  const [appAcao, setAppAcao] = useState<AppAcao>("iniciar")
  const [valor, setValor] = useState("")
  const [chave, setChave] = useState<{ segredo: string; uri: string } | null>(null)
  const [codigosRecuperacao, setCodigosRecuperacao] = useState<string[]>([])
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Confirmações ("Senha alterada.") somem sozinhas; erros ficam até a próxima ação.
  useEffect(() => {
    // Enquanto o campo do código está aberto, o aviso "enviamos um código" continua útil.
    if (!message?.ok || step === "codigo") return
    const timer = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [message, step])

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

  function askAppPassword(acao: AppAcao) {
    setMessage(null)
    setValor("")
    setAppAcao(acao)
    setStep("app-senha")
  }

  function submitAppPassword(event: FormEvent) {
    event.preventDefault()
    const body = { senha: valor }
    void run(async () => {
      if (appAcao === "iniciar") {
        setChave(await api<{ segredo: string; uri: string }>("/api/auth/2fa/totp/iniciar", { method: "POST", body, redirectOn401: false }))
        setValor("")
        setStep("app-codigo")
      } else if (appAcao === "desligar") {
        await api("/api/auth/2fa/totp/desativar", { method: "POST", body, redirectOn401: false })
        setAppAtivo(false)
        setValor("")
        setStep("idle")
        setMessage({ ok: true, text: "Aplicativo autenticador desligado." })
      } else {
        const result = await api<{ codigosRecuperacao: string[] }>("/api/auth/2fa/totp/codigos", { method: "POST", body, redirectOn401: false })
        setCodigosRecuperacao(result.codigosRecuperacao)
        setValor("")
        setStep("app-guardar")
      }
    })
  }

  function confirmApp(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const result = await api<{ codigosRecuperacao: string[] }>("/api/auth/2fa/totp/confirmar", {
        method: "POST",
        body: { codigo: valor },
        redirectOn401: false,
      })
      setAppAtivo(true)
      setChave(null)
      setValor("")
      setCodigosRecuperacao(result.codigosRecuperacao)
      setStep("app-guardar")
    })
  }

  function finishSaving() {
    setCodigosRecuperacao([])
    setStep("idle")
    // A mensagem depende de como se chegou aqui: ligar o app ou só gerar códigos novos (o app já estava ligado).
    setMessage({ ok: true, text: appAcao === "codigos" ? "Novos códigos de recuperação guardados." : "Aplicativo autenticador ligado." })
  }

  function copyCodes() {
    // `navigator.clipboard` não existe em página sem HTTPS (ex.: endereço interno em http): sem esta guarda o clique falharia
    // em silêncio.
    if (!navigator.clipboard?.writeText) {
      setMessage({ ok: false, text: "Este navegador não permite copiar aqui. Use “Baixar”." })
      return
    }
    void navigator.clipboard
      .writeText(codigosRecuperacao.join("\n"))
      .then(() => setMessage({ ok: true, text: "Códigos copiados." }))
      .catch(() => setMessage({ ok: false, text: "Não foi possível copiar. Use “Baixar”." }))
  }

  function downloadCodes() {
    const texto = [
      "Central de Balanços — códigos de recuperação",
      `Conta: ${user.email}`,
      "Cada código vale uma vez. Guarde em local seguro.",
      "",
      ...codigosRecuperacao,
      "",
    ].join("\r\n")
    downloadTextFile("codigos-de-recuperacao.txt", texto, "text/plain;charset=utf-8")
  }

  function cancel() {
    setStep("idle")
    setValor("")
    setChave(null)
    setMessage(null)
  }

  const cancelButton = (
    <Button type="button" size="sm" variant="outline" onClick={cancel}>
      Cancelar
    </Button>
  )

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" />
        <span className="flex-1">
          2 etapas por e-mail:{" "}
          <strong className="font-medium text-foreground">{ativo || (obrigatorio && !appAtivo) ? "ligada" : "desligada"}</strong>
          {obrigatorio && " (exigida pelo seu perfil)"}
        </span>
      </div>

      {step === "idle" && (!obrigatorio || appAtivo) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          className="mt-1.5 w-full justify-start"
          onClick={ativo ? () => { setMessage(null); setValor(""); setStep("desligar") } : startEnable}
        >
          {ativo ? "Desligar por e-mail" : "Ligar por e-mail"}
        </Button>
      )}

      {step === "codigo" && (
        <form onSubmit={confirmEnable} className="mt-2 flex flex-col gap-2">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Código de 6 dígitos recebido por e-mail"
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
            {cancelButton}
          </div>
        </form>
      )}

      {step === "desligar" && (
        <form onSubmit={confirmDisable} className="mt-2 flex flex-col gap-2">
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Sua senha para confirmar"
            aria-label="Sua senha para confirmar"
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
            {cancelButton}
          </div>
        </form>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Smartphone className="size-3.5 shrink-0" />
        <span className="flex-1">
          App autenticador: <strong className="font-medium text-foreground">{appAtivo ? "ligado" : "desligado"}</strong>
        </span>
      </div>

      {step === "idle" && (
        <div className="mt-1.5 flex flex-col">
          {appAtivo ? (
            <>
              <Button type="button" size="sm" variant="ghost" disabled={busy} className="w-full justify-start" onClick={() => askAppPassword("codigos")}>
                Novos códigos de recuperação
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} className="w-full justify-start" onClick={() => askAppPassword("desligar")}>
                Desligar o aplicativo
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} className="w-full justify-start" onClick={() => askAppPassword("iniciar")}>
              Ligar o aplicativo
            </Button>
          )}
        </div>
      )}

      {step === "app-senha" && (
        <form onSubmit={submitAppPassword} className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{APP_SENHA_TEXTO[appAcao].ajuda}</p>
          <input
            type="password"
            autoComplete="current-password"
            aria-label="Sua senha para confirmar"
            placeholder="Sua senha"
            required
            autoFocus
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy} className="flex-1">
              {APP_SENHA_TEXTO[appAcao].botao}
            </Button>
            {cancelButton}
          </div>
        </form>
      )}

      {step === "app-codigo" && chave && (
        <form onSubmit={confirmApp} className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            No aplicativo (Google Authenticator, Authy, 1Password…), adicione uma conta <strong>por chave</strong> com este código
            (tipo “baseado em tempo”):
          </p>
          <code
            data-testid="totp-chave"
            className="select-all break-words rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs text-foreground"
          >
            {chave.segredo}
          </code>
          <a href={chave.uri} className="text-xs text-primary-text underline underline-offset-2">
            Abrir no aplicativo (no celular)
          </a>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Código de 6 dígitos mostrado no aplicativo"
            placeholder="Código de 6 dígitos do app"
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
            {cancelButton}
          </div>
        </form>
      )}

      {step === "app-guardar" && (
        <div className="mt-2 flex flex-col gap-2" data-testid="codigos-recuperacao">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Guarde estes códigos</strong> em um lugar seguro. Se você perder o celular, cada um
            deixa você entrar uma vez. Eles <strong>não serão mostrados de novo</strong>.
          </p>
          <ul className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border border-border bg-muted px-2 py-1.5 font-mono text-xs text-foreground">
            {codigosRecuperacao.map((codigo) => (
              <li key={codigo} className="select-all">
                {codigo}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" className="flex-1" onClick={copyCodes}>
              Copiar
            </Button>
            <Button type="button" size="sm" variant="outline" className="flex-1" onClick={downloadCodes}>
              Baixar
            </Button>
          </div>
          <Button type="button" size="sm" onClick={finishSaving}>
            Já guardei
          </Button>
        </div>
      )}

      {message && (
        <p role="status" className={message.ok ? "mt-2 text-xs text-ok" : "mt-2 text-xs text-destructive"}>
          {message.text}
        </p>
      )}
    </div>
  )
}
