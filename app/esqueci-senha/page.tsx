import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ForgotPasswordForm } from "@/components/forgot-password-form"
import { mailAvailable } from "@/lib/server/mail"

export const metadata: Metadata = { title: "Esqueci minha senha · Central de Balanços" }
export const dynamic = "force-dynamic" // depende de variável de ambiente (SMTP) lida a cada requisição

export default function ForgotPasswordPage() {
  // Sem e-mail configurado a recuperação não funciona; melhor não mostrar a tela do que
  // deixar a pessoa esperando um e-mail que nunca chega.
  if (!mailAvailable()) redirect("/login")
  return <ForgotPasswordForm />
}
