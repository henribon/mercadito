# Mercadito

Lista de mercado compartilhada entre duas pessoas, com histórico de compras lido
direto do QR Code do cupom fiscal (NFC-e de São Paulo).

- **O que falta comprar** — lista única, compartilhada entre os dois celulares.
- **O que já compramos** — escaneia o QR do cupom e importa itens, quantidades e preços.
- **Última vez comprado** — cada produto guarda data, preço e frequência.
- **Lembrete de reposição** — marque um produto como "compramos sempre" e ele
  reaparece na lista quando passa do intervalo de costume.

Custo zero: o plano gratuito do Neon permite 100 projetos e a Vercel hospeda o
app de graça.

---

## Stack

| Camada | Escolha |
| --- | --- |
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| Estilo | Tailwind CSS v4, tema claro/escuro automático |
| Banco | Neon (Postgres serverless) via `pg` |
| Autenticação | Better Auth, magic link por e-mail |
| Acesso a dados | Server Actions — o banco nunca é exposto ao navegador |
| Leitura do QR | `@zxing/browser` (carregado sob demanda) |
| Leitura da nota | Rota `/api/nfce` no servidor + `cheerio` |

---

## 1. Criar o banco no Neon

1. Crie um projeto em [neon.com](https://neon.com) (plano Free).
   Escolha a região **AWS São Paulo (sa-east-1)** para menor latência.
2. Em **Connection string**, copie a versão **Pooled** — o host tem `-pooler`.

## 2. Configurar o projeto

```bash
npm install
cp .env.local.example .env.local
```

Preencha o `.env.local`:

```env
DATABASE_URL=postgresql://...-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 3. Criar as tabelas

**Nesta ordem.** O schema da aplicação referencia a tabela `"user"`, que é criada
pelo Better Auth.

Primeiro as tabelas de autenticação (`user`, `session`, `account`, `verification`):

```bash
npx auth@latest migrate
```

Depois cole o conteúdo de [`neon/schema.sql`](neon/schema.sql) no **SQL Editor**
do console do Neon e execute.

## 4. Rodar

```bash
npm run dev
```

Abra `http://localhost:3000` e peça o link de acesso. **Sem SMTP configurado o
link aparece no terminal**, o que permite testar tudo antes de mexer com e-mail.

Ao entrar, crie a casa. O código de convite aparece na aba **Produtos**, no fim
da página — é ele que sua esposa usa para entrar na mesma lista.

## 5. Envio do link por e-mail

Para o link chegar de verdade no celular dela, configure um SMTP. O caminho
gratuito e sem burocracia é uma **senha de app do Gmail** (Conta Google →
Segurança → Verificação em duas etapas → Senhas de app):

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=voce@gmail.com
SMTP_PASS=a-senha-de-app-de-16-letras
SMTP_FROM=voce@gmail.com
```

> Serviços como Resend exigem domínio próprio para enviar a terceiros — no plano
> grátis sem domínio você só consegue mandar para si mesmo. O Gmail não tem essa
> limitação.

## 6. Publicar na Vercel

1. Suba o projeto para um repositório no GitHub.
2. Na Vercel, **Add New → Project** e importe o repositório.
3. Copie as variáveis do `.env.local`, trocando `BETTER_AUTH_URL` e
   `NEXT_PUBLIC_SITE_URL` pela URL final (`https://SEU-APP.vercel.app`).

## 7. Instalar no celular

O app é uma PWA. Abra a URL no celular e:

- **Android (Chrome):** menu → *Instalar aplicativo*
- **iPhone (Safari):** compartilhar → *Adicionar à Tela de Início*

A câmera do leitor de QR exige HTTPS — funciona na Vercel e em `localhost`,
mas não se você acessar o dev server pelo IP da rede local.

---

## Como funciona no dia a dia

**Faltou algo.** Digite na aba *Lista*. Enquanto você digita, o app sugere
produtos que já existem no catálogo mostrando quando foram comprados pela última
vez e por quanto — assim vocês não criam "leite", "Leite" e "leite integral"
como três coisas diferentes.

**Compraram.** Na aba *Escanear*, leia o QR Code no rodapé do cupom. O app
consulta a SEFAZ, lista os itens e mostra a qual produto cada linha será ligada.
Você confere, ajusta o que estiver errado e salva. Tudo que estava na lista e
apareceu na nota sai da lista automaticamente.

**O app aprende.** Ao confirmar que `LEITE INTEG ITALAC 1L` é o produto
"Leite integral", esse apelido fica salvo. Na próxima nota do mesmo mercado o
casamento é automático.

**Reposição.** Na aba *Produtos*, abra um item e ligue *Compramos sempre*. O
intervalo já vem preenchido com a média real do seu histórico. Quando passar
desse prazo, o produto aparece em **Hora de repor** no topo da lista.

---

## Decisões de arquitetura

**Sem RLS, escopo no servidor.** O Postgres do Neon não é exposto ao navegador:
todo acesso passa por Server Actions, e cada uma começa resolvendo a casa a
partir da sessão (`requireMembership()` em [`src/lib/session.ts`](src/lib/session.ts)).
O cliente nunca informa em qual casa está mexendo. Essa é a fronteira de
segurança — se você adicionar uma consulta nova, ela precisa filtrar pelo
`household.id` vindo dali.

**Sincronização por polling, não realtime.** O app busca mudanças a cada 15
segundos, mas só com a aba visível, e sempre ao voltar para ela. Para uma lista
de duas pessoas isso é imperceptível e gasta menos bateria que manter um
WebSocket aberto. Está em [`src/components/AppProvider.tsx`](src/components/AppProvider.tsx).

**SQL num módulo próprio.** As consultas não triviais ficam em
[`src/lib/sql.ts`](src/lib/sql.ts) em vez de embutidas nas actions, para que os
testes executem exatamente o SQL que roda em produção.

---

## Sobre a leitura da nota fiscal

O QR Code do cupom aponta para o portal da SEFAZ do estado emissor. Este app lê
o portal de **São Paulo** (`nfce.fazenda.sp.gov.br`). Notas de outras UFs são
detectadas pela chave de acesso e recusadas com uma mensagem clara, em vez de
falharem em silêncio.

Antes de bater na SEFAZ, o app valida o dígito verificador (módulo 11) da chave
de 44 dígitos — isso descarta QR borrado ou digitação errada sem gastar uma
requisição.

Se a câmera não abrir, dá para colar a URL da nota ou a chave de 44 dígitos no
campo abaixo do botão.

**Limitação conhecida:** o portal da SEFAZ é uma aplicação ASP.NET antiga e o
HTML pode mudar sem aviso. O parser em [`src/lib/nfce/parse.ts`](src/lib/nfce/parse.ts)
é tolerante (seletores com fallback para regex) e a tela de conferência sempre
deixa você corrigir antes de salvar, mas uma mudança grande no portal exigiria
ajustar os seletores.

Para dar suporte a outra UF, acrescente o portal em
[`src/lib/nfce/qr.ts`](src/lib/nfce/qr.ts) e o parser correspondente — a
estrutura `NfceReceipt` já é agnóstica de estado.

---

## Testes

```bash
npm test
```

São 33 testes em duas frentes:

- **Parsing e casamento de nomes** — HTML da SEFAZ, números e datas em formato
  brasileiro, validação da chave de acesso, similaridade de nomes de produto.
- **Banco de dados** — o schema e as consultas de produção rodam contra um
  Postgres real ([PGlite](https://pglite.dev), Postgres compilado para WASM),
  sem precisar de banco remoto. Cobre a matemática do `product_stats`, o índice
  que impede item duplicado na lista, os cascades e o isolamento entre casas.

```bash
npm run typecheck
```

---

## Estrutura

```
src/
  app/
    page.tsx              Lista: pendentes, sugestões de reposição, adicionar
    escanear/             Câmera, consulta à SEFAZ e conferência da nota
    historico/            Compras e detalhe de cada nota
    produtos/             Catálogo, recorrência, código de convite
    api/auth/[...all]/    Rotas do Better Auth
    api/nfce/             Proxy autenticado para o portal da SEFAZ
  components/             Provider com polling, tab bar, scanner, ícones
  lib/
    actions.ts            Server Actions: toda a camada de dados
    session.ts            Fronteira de segurança (sessão -> casa)
    sql.ts                Consultas SQL, compartilhadas com os testes
    db.ts                 Pool do Postgres e conversão de tipos
    auth.ts               Better Auth (magic link)
    email.ts              Envio do link via SMTP
    nfce/qr.ts            Interpreta o conteúdo do QR e valida a chave
    nfce/parse.ts         Extrai itens e totais do HTML da SEFAZ
    normalize.ts          Normalização e similaridade de nomes de produto
    data.ts               Regras puras: recorrência e sugestões
neon/schema.sql           Tabelas, índices e a view de estatísticas
tests/                    Parser, normalização e banco (PGlite)
```
