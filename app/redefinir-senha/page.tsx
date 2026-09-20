import type { Metadata } from "next"
import { ResetPasswordForm } from "@/components/reset-password-form"

// O token está na URL: sem Referer, ele não vaza para nenhum site que a página venha a carregar.
export const metadata: Metadata = {
  title: "Nova senha · Central de Balanços",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  return <ResetPasswordForm token={typeof token === "string" && token ? token : null} />
}
