// Cabeçalhos de segurança enviados em toda resposta (defesa em profundidade: a proteção dos dados
// continua nas rotas; isto reduz o estrago se algo escapar, ex.: um XSS ou um iframe malicioso).
function securityHeaders() {
  const isProd = process.env.NODE_ENV === "production"

  const csp = [
    "default-src 'self'",
    // O Next injeta scripts inline para hidratar a página: sem nonces por requisição, 'unsafe-inline'
    // é necessário. 'unsafe-eval' só no desenvolvimento (o webpack do dev usa eval) — nunca em produção.
    // 'wasm-unsafe-eval' deixa o pdfjs (leitor de PDF) compilar WebAssembly, sem liberar eval de JS.
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isProd ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Só fala com o próprio servidor: um script injetado não consegue enviar dados para fora.
    "connect-src 'self'",
    // O worker do pdfjs vem do mesmo bundle (ver lib/extraction/pdf-text.ts), nunca de um CDN.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Ninguém pode embutir o app em um iframe (clickjacking).
    "frame-ancestors 'none'",
  ].join("; ")

  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" }, // equivalente ao frame-ancestors, para navegadores antigos
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ]
  // HSTS só em produção (e só vale sobre HTTPS): em desenvolvimento local forçaria https em localhost.
  if (isProd) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" })
  return headers
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      // Respostas da API (sessão, usuários, dados financeiros) nunca devem ir para cache de
      // navegador, proxy ou CDN.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ]
  },
}

export default nextConfig
