import type { Metadata } from "next"
import { LoginForm } from "@/components/auth/login-form"
import { googleConfig } from "@/lib/server/auth/google"
import { mailAvailable } from "@/lib/server/mail/mail"

export const metadata: Metadata = { title: "Entrar · Central de Balanços" }

// Depende de variável de ambiente (Google configurado ou não): tem que ser lida a cada
// requisição, não congelada no build.
export const dynamic = "force-dynamic"

// Códigos de `?erro=` devolvidos pelo fluxo do Google (app/api/auth/google/callback).
const ERROS: Record<string, string> = {
  google_indisponivel: "O login com Google não está configurado neste ambiente.",
  google_negado: "O acesso com Google foi cancelado.",
  google_falhou: "Não foi possível entrar com o Google. Tente novamente.",
  google_sem_cadastro: "Este e-mail Google não está cadastrado. Peça a um administrador para criar o seu acesso.",
  google_email_nao_verificado: "O Google não confirmou este e-mail. Use outra conta.",
  conta_inativa: "Esta conta está desativada. Fale com um administrador.",
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams
  return (
    <LoginForm
      googleEnabled={googleConfig() !== null}
      recoveryEnabled={mailAvailable()}
      initialError={erro ? (ERROS[erro] ?? null) : null}
    />
  )
}
