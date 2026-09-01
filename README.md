# Mercadito

Lista de mercado compartilhada entre duas pessoas, com histórico de compras lido
direto do QR Code do cupom fiscal (NFC-e de São Paulo).

- **O que falta comprar** — lista única, compartilhada entre os dois celulares.
- **O que já compramos** — escaneia o QR do cupom e importa itens, quantidades e preços.
- **Última vez comprado** — cada produto guarda data, preço e frequência.
- **Lembrete de reposição** — marque um produto como "compramos sempre" e ele
  reaparece na lista quando passa do intervalo de costume.
- **Entrar com 4 dígitos** — depois do primeiro acesso por e-mail, cada um cria
  o próprio código e abre o app sem esperar link nenhum.

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

Depois o schema da aplicação:

```bash
npm run db:setup
```

O `db:setup` aplica [`neon/schema.sql`](neon/schema.sql), confere que as tabelas
de autenticação já existem e lista o que criou. É idempotente — pode rodar de
novo depois de alterar o schema.

## 4. Rodar

```bash
npm run dev
```

Abra `http://localhost:3000` e peça o link de acesso. **Sem SMTP configurado o
link aparece no terminal**, o que permite testar tudo antes de mexer com e-mail.

Ao entrar, crie a casa. O código de convite aparece na aba **Produtos**, no fim
da página — é ele que sua esposa usa para entrar na mesma lista.

Ainda na aba **Produtos**, em *Entrar no app*, crie seu **código de 4 dígitos**.
Da próxima vez a tela de login já vem com o teclado numérico, e o e-mail só volta
a ser necessário em um aparelho novo.

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
3. Em **Settings → Environment Variables**, recrie as variáveis do `.env.local`,
   trocando `BETTER_AUTH_URL` e `NEXT_PUBLIC_SITE_URL` pela URL final
   (`https://SEU-APP.vercel.app`). Se ficarem em `localhost`, o link de acesso
   enviado por e-mail aponta para a máquina de quem clicou e o login quebra.

Depois disso é só `git push`: a Vercel builda e publica sozinha.

> **Onde as variáveis vivem.** São três lugares com propósitos diferentes:
> `.env.local` (sua máquina, nunca commitado), **Vercel → Environment Variables**
> (produção) e **GitHub → Secrets** (apenas GitHub Actions). A Vercel puxa o
> *código* do GitHub, mas nunca lê os Secrets dele — colocar o `DATABASE_URL` lá
> só exporia a senha do banco sem ter efeito nenhum.

### Por que não GitHub Pages

O GitHub Pages serve arquivos estáticos, sem execução no servidor, e este app
precisa de servidor por dois motivos independentes:

- O portal da SEFAZ **não envia cabeçalho CORS**, então nenhuma página no
  navegador consegue ler a nota fiscal — a consulta tem que sair de um servidor
  (é o que a rota [`/api/nfce`](src/app/api/nfce/route.ts) faz).
- As credenciais do Postgres nunca podem ir para o navegador; por isso todo
  acesso a dados passa por Server Actions.

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

**Quem entra no app.** Pedir um link de acesso exige um código, validado no
servidor pelo hook `before` do Better Auth em [`src/lib/auth.ts`](src/lib/auth.ts).
A regra está em [`src/lib/access.ts`](src/lib/access.ts):

- quem já tem conta entra sempre, sem repetir o código;
- se ainda não existe nenhuma casa, o primeiro acesso é liberado — é quem vai
  criar a casa e gerar o código;
- qualquer outra pessoa precisa apresentar o código de convite de uma casa.

O código é o mesmo que aparece na aba Produtos: ele autoriza a entrada **e**
define em qual casa a pessoa cai. Quem entra com ele é adicionado à casa
automaticamente, sem passar por tela de onboarding.

A validação é no servidor de propósito: esconder o campo no formulário não
impediria ninguém de chamar a API diretamente.

**Entrar sem e-mail, com 4 dígitos.** O magic link é ótimo para a primeira vez e
péssimo para todo dia: abrir o e-mail no meio do mercado é atrito. Depois de
entrar uma vez, cada pessoa cria um código de 4 dígitos na aba Produtos.

Quatro dígitos são só 10 mil combinações, então o código sozinho não guarda
nada — quem identifica a pessoa é o **aparelho**. Ao criar o código, o navegador
recebe um cookie httpOnly com um token aleatório de 32 bytes; no banco fica
apenas o `sha256` dele, ligado ao dono em `trusted_devices`. Sem esse cookie o
código nem chega a ser conferido, então não há como alguém varrer as combinações
de fora. Cinco erros seguidos derrubam a confiança do aparelho e o e-mail volta a
ser exigido. O código em si é guardado com `scrypt` e sal por usuário.

A regra está em [`src/lib/pin.ts`](src/lib/pin.ts) e os endpoints em
[`src/lib/pin-plugin.ts`](src/lib/pin-plugin.ts) — um plugin do Better Auth, e
não uma Server Action, porque entrar pelo código cria uma sessão e isso exige o
contexto de um endpoint do próprio Better Auth.

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

São 84 testes em quatro frentes:

- **Parsing e casamento de nomes** — HTML da SEFAZ, números e datas em formato
  brasileiro, validação da chave de acesso, similaridade de nomes de produto.
- **Portão de acesso** — quem pode pedir um link de entrada: usuário conhecido,
  primeiro acesso de todos, código certo, código errado e código ausente.
- **Código de 4 dígitos** — o par aparelho + código: hash e conferência, cookie
  de outro aparelho, código de quem já removeu o dele, e as tentativas até o
  aparelho perder a confiança.
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
    produtos/             Catálogo, recorrência, código de convite, código de acesso
    api/auth/[...all]/    Rotas do Better Auth
    api/nfce/             Proxy autenticado para o portal da SEFAZ
  components/             Provider com polling, tab bar, scanner, ícones, PinInput
  lib/
    actions.ts            Server Actions: toda a camada de dados
    session.ts            Fronteira de segurança (sessão -> casa)
    sql.ts                Consultas SQL, compartilhadas com os testes
    db.ts                 Pool do Postgres e conversão de tipos
    auth.ts               Better Auth (magic link + código de 4 dígitos)
    pin.ts                Regra e criptografia do código de 4 dígitos
    pin-plugin.ts         Endpoints /api/auth/codigo/* (plugin do Better Auth)
    email.ts              Envio do link via SMTP
    nfce/qr.ts            Interpreta o conteúdo do QR e valida a chave
    nfce/parse.ts         Extrai itens e totais do HTML da SEFAZ
    normalize.ts          Normalização e similaridade de nomes de produto
    data.ts               Regras puras: recorrência e sugestões
neon/schema.sql           Tabelas, índices e a view de estatísticas
scripts/db-setup.mjs      Aplica o schema no banco (npm run db:setup)
tests/                    Parser, normalização, códigos de acesso e banco (PGlite)
```
