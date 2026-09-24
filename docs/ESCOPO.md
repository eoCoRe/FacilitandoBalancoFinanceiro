# Escopo do TCC — Central de Balanços

Revisão de 24/09/2026. Entrega prevista: por volta de 24/10/2026.
Objetivo: fechar o escopo. Cada item da seção 3 precisa de um **SIM** ou **NÃO**.

Estimativas em **sessões** de trabalho como a de 24/09 (2 a 3 horas cada, eu programando e você conferindo na tela).

## Decisões tomadas (24/09/2026)

| # | Decisão |
|---|---|
| D1 | **Feito**: "Session 2" mesclada na branch `tcc/ajustes` (commit `2760c29`) |
| D2 | **SIM**: IA via **API de LLM externa** (não modelo próprio treinado), como no RFC §5.4/§5.5 |
| D3 | **Feito**: várias empresas (commits `1e5195a` a `bf96e4c`) |
| D4 | **Publicar, mas não na Vercel** (plataforma a definir) |
| D6 | Em explicação |
| D7, D8, D9 | **SIM** |
| D10 | Pesquisar a melhor fonte de mercado (recomendação: CVM Dados Abertos, DFP; ver conversa) |

---

## 1. O que já temos (pronto e testado)

**Análise financeira**
- Plano de Contas editável (grupos e contas analíticas).
- Tabulação do Balanço e da DRE por exercício, com totais automáticos e escala (reais / milhares / milhões).
- Demonstrações: Balanço, DRE, DFC (a DFC é só visualização, fora do escopo pelo §2.6 do RFC) e Balancete.
- Índices financeiros (liquidez, endividamento, rentabilidade, atividade) comparados a médias do setor. Quando
  falta dado, o índice aparece como "dados insuficientes" e não como zero (RN04).
- Dashboard com liquidez e pontos de atenção.
- Parecer de Crédito automático: critérios com peso, score, classificação (favorável / com ressalvas /
  desfavorável), limite sugerido e impressão em PDF.
- Exportação em CSV de todas as demonstrações e dos índices.

**Extração de PDF** (melhorada em 24/09; ver `docs/ARQUITETURA.md` §6.1)
- Leitor **por regras** (sem IA) que lê Balanço **e DRE**, escolhe a coluna do ano mais recente, entende sinais
  de balancete, respeita as seções do balanço e converte reais para milhares.
- Revisão humana obrigatória antes de gravar (human-in-the-loop).
- Histórico de cada extração, com o texto original e a página de cada valor (RF06).
- `pnpm avaliar:extracao`: mede o leitor em PDFs reais. Nos 3 balanços testados, reconheceu 64% das contas do
  Balanço e 71% das linhas da DRE, com confiança média de 96%.

**Segurança, LGPD e auditoria** (RNF02, RNF03, §6 do RFC; ver `SECURITY.md`)
- Login com senha, 2 etapas (e-mail ou aplicativo autenticador), perfis analista / coordenador / administrador.
- Trilha de auditoria com selos encadeados (detecta adulteração) e exportação.
- LGPD: exportação, eliminação, expurgo por prazo, "baixar meus dados".
- Proteções: CSRF, limite de tentativas, cabeçalhos de segurança, senhas fortes.

**Qualidade**
- 907 testes automáticos, lint, checagem de tipos, build de produção e teste de fumaça contra Postgres real,
  tudo passando. CI no GitHub.
- Documentação: `README.md`, `docs/ARQUITETURA.md`, `docs/OPERACAO.md`, `SECURITY.md`.

---

## 2. Achados da revisão (importantes)

1. **Trabalho seu que não chegou na `main`.** O commit `aee4e3f` ("Session 2") foi mesclado na branch
   `chore/ajustes-noturnos` **depois** que ela já tinha entrado na `main` (PR #12). Ficaram de fora: tela de cadastro
   de empresa, layout para celular, contraste AA, validação de CNPJ, o nome "Extração de PDF" e o botão
   "Novo índice" (hoje ele não faz nada). Tentei trazer para a branch `tcc/ajustes`, mas a permissão foi negada;
   precisa ser feito por você ou com a sua autorização (item D1).
2. **O RFC não está no computador.** O código cita RF01, RF02, RF05, RF06, RF08, RN01, RN04, RNF02, RNF03 e as
   seções §2.6, §3.2, §5.4, §5.5 e §6. **Nunca aparecem:** RF03, RF04, RF07, RN02, RN03 e RNF01. Pode haver
   requisito prometido e não feito; só dá para saber com o PDF das regras.
3. **Dois documentos divergem sobre a IA.** O RFC (§5.4/§5.5) fala em **API de LLM externa**; um
   `diagramas_modelo_proprio.md` (citado no `SECURITY.md`, mas não encontrado) falava em **modelo próprio treinado**.
   Precisa escolher um e alinhar a monografia.
4. **As médias do setor são ilustrativas** (`lib/sector-benchmarks.ts` diz isso). A banca pode perguntar a fonte.
5. **O parecer não é salvo.** Ele é recalculado toda vez; não fica registrado "quem decidiu o quê, quando, com qual
   limite". Numa análise de crédito real, o registro da decisão é o produto final.
6. **Não revisado a fundo:** a lista completa de índices e a fórmula do score (`lib/financial-data.ts`). A leitura
   foi bloqueada pela permissão automática nesta sessão.

---

## 3. Decisões: SIM ou NÃO?

### Grupo A — essencial (recomendo SIM)

| # | Item | Por quê | Esforço | Recomendo |
|---|---|---|---|---|
| D1 | Trazer a "Session 2" para a `main` | É trabalho seu pronto e testado (empresa, celular, acessibilidade). Precisa da sua autorização | 0,5 sessão | **SIM** |
| D2 | **Extração com IA de verdade** (LLM via API, anonimizado, revisão humana) | Você já decidiu: o TCC exige IA | 3 sessões | **SIM (já decidido)** |
| D3 | Várias empresas (cadastro, seletor, dados separados) | Sem isso, o balanço de uma empresa apaga o da outra; é a 1ª pergunta que a banca faz | 2 a 3 sessões | **SIM** |
| D4 | Publicar na internet para a banca (Vercel + Postgres gerenciado) | Demo sem depender do seu notebook; o RFC já cita o Neon | 1 sessão | **SIM** |
| D5 | Monografia e apresentação | É o que é avaliado. Os docs do repositório são a base dos capítulos | ~8 dias seus | **SIM** |

### Grupo B — fortalece o TCC (recomendo SIM se couber)

| # | Item | Por quê | Esforço | Recomendo |
|---|---|---|---|---|
| D6 | Comparar **IA × regras** com `pnpm avaliar:extracao` (acerto por conta, com gabarito) | Vira o capítulo de resultados, com números. Precisa conferir à mão uns 5 a 10 balanços | 1 sessão + seu tempo | **SIM** |
| D7 | Registrar o parecer (data, analista, classificação, limite aprovado, justificativa) e manter histórico | Fecha o ciclo da análise de crédito e deixa rastro auditável | 1 sessão | **SIM** |
| D8 | Ler PDF escaneado (IA com visão) | Muitos balanços assinados vêm escaneados; hoje não são lidos | 0,5 sessão (junto com D2) | **SIM** |
| D9 | Análise horizontal e vertical (AH/AV) | Clássico da análise de balanços; banca de contábeis/ADM costuma esperar | 1 sessão | **SIM se couber** |
| D10 | Fonte das médias do setor (citar fonte pública ou deixar o analista editar) | Evita a pergunta "de onde vieram esses números?" | 0,5 sessão | **SIM se couber** |

### Grupo C — não faz sentido agora (recomendo NÃO)

| # | Item | Por que não |
|---|---|---|
| D11 | Comparar empresas entre si | Depende de D3; é luxo para o prazo |
| D12 | DFC editável | O próprio RFC tira do escopo (§2.6) |
| D13 | Autocadastro com aprovação | O modelo atual (administrador cria acessos) é mais seguro e defensável |
| D14 | Ativar login com Google | Já está implementado; ativar exige credenciais e não agrega à banca |
| D15 | QR Code no 2FA, Redis para o limite de tentativas, âncora externa da auditoria, agendar expurgo | Segurança de produção, além do que o TCC precisa; já documentados como limites |
| D16 | Testes de interface automatizados (Playwright) | Os 907 testes + teste de fumaça já dão boa cobertura; melhor gastar o tempo em D2/D3 |

---

## 4. Cabe no prazo?

Até 24/10 são cerca de 4 semanas. Reservando ~8 dias para a monografia e a apresentação:

| Semana | Foco |
|---|---|
| 25/09 – 01/10 | D1, D3 (várias empresas), D4 (publicar) |
| 02/10 – 08/10 | D2 + D8 (IA, inclusive PDF escaneado), D7 (registrar parecer) |
| 09/10 – 15/10 | D6 (avaliação IA × regras), D9/D10 se couber; **começar a monografia** |
| 16/10 – 24/10 | Monografia, ensaio da apresentação, só correções no código |

Grupo A + Grupo B cabem, **desde que** o escopo feche agora e nada do Grupo C entre.
