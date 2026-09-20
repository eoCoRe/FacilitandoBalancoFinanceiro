import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Manrope, Space_Grotesk, Space_Mono } from 'next/font/google'
import './globals.css'

// Manrope (texto/UI) + Space Grotesk (títulos e números de destaque) + Space Mono
// (valores tabulares) — trio com personalidade própria, em vez do combo
// Inter + JetBrains Mono que praticamente todo template gerado por IA usa por padrão.
const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
})

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Central de Balanços',
  description:
    'Plataforma de análise de balanços para analistas de crédito — Plano de Contas, Tabulação, Balanço, DRE, DFC e Índices Financeiros.',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${manrope.variable} ${spaceGrotesk.variable} ${spaceMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        {children}
        {/* O script existe só na Vercel; fora dela daria 404 a cada página. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  )
}
