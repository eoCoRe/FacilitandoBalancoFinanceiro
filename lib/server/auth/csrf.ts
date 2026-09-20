// Proteção contra CSRF nas rotas de API que MUDAM dados, em camadas sobre o cookie SameSite=Lax:
//  - o navegador manda `Sec-Fetch-Site` em toda requisição (Fetch Metadata) e não deixa a página de
//    outro site alterar o valor. Uma mutação só é aceita se vier de "same-origin" (o próprio app) ou "none"
//    (ação direta do usuário). "same-site" também é recusado: um subdomínio comprometido (ou outro app no
//    mesmo domínio) é do mesmo SITE, então o cookie Lax iria junto — e não deve poder agir aqui;
//  - navegadores antigos sem esse cabeçalho: se houver `Origin`, ele precisa ser o próprio host;
//  - sem nenhum dos dois (curl, testes, scripts) a requisição passa: não é um navegador sendo enganado, e
//    sem o cookie da vítima não há o que abusar. A autenticação de cada rota continua valendo.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function isCrossOriginMutation(method: string, headers: Pick<Headers, "get">): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false

  const fetchSite = headers.get("sec-fetch-site")
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none"

  const origin = headers.get("origin")
  if (origin) {
    const host = headers.get("x-forwarded-host") ?? headers.get("host")
    try {
      return !host || new URL(origin).host !== host
    } catch {
      return true // Origin ilegível (ex.: "null")
    }
  }
  return false
}
