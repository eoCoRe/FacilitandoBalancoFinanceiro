"use client"

// Erro no próprio layout raiz: esta tela SUBSTITUI o documento inteiro, então traz o seu <html> e
// <body> e não herda o CSS global — por isso o estilo é inline e segue o esquema de cores do sistema.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <div role="alert" style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Algo deu errado</h1>
          <p style={{ fontSize: 14, margin: "0 0 12px", opacity: 0.75 }}>
            O sistema encontrou um erro e não conseguiu carregar. Tente novamente; se continuar, avise o administrador.
          </p>
          {error.digest && <p style={{ fontSize: 12, opacity: 0.6 }}>Código do erro: {error.digest}</p>}
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 8, padding: "8px 16px", fontSize: 14, cursor: "pointer" }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  )
}
