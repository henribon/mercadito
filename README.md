# Mercadito

Lista de mercado compartilhada entre duas pessoas, com histórico de compras lido
direto do QR Code do cupom fiscal (NFC-e de São Paulo).

- **O que falta comprar** — lista única, sincronizada em tempo real nos dois celulares.
- **O que já compramos** — escaneia o QR do cupom e importa itens, quantidades e preços.
- **Última vez comprado** — cada produto guarda data, preço e frequência.
- **Lembrete de reposição** — marque um produto como "compramos sempre" e ele
  reaparece na lista quando passa do intervalo de costume.

Sem custo: roda no free tier do Supabase e da Vercel.

---

## Stack

| Camada | Escolha |
| --- | --- |
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| Estilo | Tailwind CSS v4, tema claro/escuro automático |
| Banco / Auth / Realtime | Supabase (Postgres + RLS + magic link) |
| Leitura do QR | `@zxing/browser` (carregado sob demanda) |
| Leitura da nota | Rota `/api/nfce` no servidor + `cheerio` |

---

## 1. Configurar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (plano free).
2. Abra **SQL Editor**, cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql)
   e execute. Isso cria as tabelas, a view de estatísticas, as políticas de RLS
   e liga o realtime.
3. Em **Authentication → Providers → Email**, deixe *Email* habilitado. Não é
   preciso mexer em mais nada: o magic link já confirma o endereço.
4. Em **Authentication → URL Configuration**, preencha:
   - *Site URL*: `http://localhost:3000` (troque pela URL da Vercel depois)
   - *Redirect URLs*: adicione `http://localhost:3000/**` e, mais tarde,
     `https://SEU-APP.vercel.app/**`

   > Use o curinga `/**`. O link de acesso volta para `/auth/callback` com um
   > parâmetro `next`, e uma URL fixa sem curinga seria rejeitada.
5. Em **Project Settings → API**, copie a *Project URL* e a chave *anon public*.

> A chave `anon` é pública por natureza — quem protege os dados é o RLS, que
> restringe tudo ao `household_id` de que você é membro.

## 2. Rodar local

```bash
npm install
```

Crie o arquivo `.env.local` a partir do exemplo e preencha com os valores do passo 1:

```bash
cp .env.local.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

```bash
npm run dev
```

Abra `http://localhost:3000`, entre com seu e-mail e crie a casa. O código de
convite aparece na aba **Produtos**, no fim da página — é ele que sua esposa usa
para entrar na mesma lista.

## 3. Publicar na Vercel

1. Suba o projeto para um repositório no GitHub.
2. Na Vercel, **Add New → Project**, importe o repositório.
3. Em *Environment Variables*, adicione as três variáveis do `.env.local`,
   trocando `NEXT_PUBLIC_SITE_URL` pela URL final (`https://SEU-APP.vercel.app`).
4. Volte ao Supabase e acrescente `https://SEU-APP.vercel.app/**` nas
   *Redirect URLs*, e troque a *Site URL* pela mesma URL.

## 4. Instalar no celular

O app é uma PWA. Abra a URL no celular e:

- **Android (Chrome):** menu → *Instalar aplicativo*
- **iPhone (Safari):** compartilhar → *Adicionar à Tela de Início*

A câmera do leitor de QR exige HTTPS — funciona na Vercel e em `localhost`,
mas não se você acessar o dev server por IP da rede local.

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
ajustar os seletores. Os testes cobrem o layout atual.

Para dar suporte a outra UF, acrescente o portal em
[`src/lib/nfce/qr.ts`](src/lib/nfce/qr.ts) e o parser correspondente — a
estrutura `NfceReceipt` já é agnóstica de estado.

---

## Testes

```bash
npm test
```

Cobrem o que é frágil e não dá para verificar sem uma nota real: parsing do HTML
da SEFAZ, números e datas em formato brasileiro, validação da chave de acesso e o
casamento de nomes de produto.

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
    api/nfce/route.ts     Proxy autenticado para o portal da SEFAZ
    auth/callback/        Destino do magic link
  components/             Provider com realtime, tab bar, scanner, ícones
  lib/
    nfce/qr.ts            Interpreta o conteúdo do QR e valida a chave
    nfce/parse.ts         Extrai itens e totais do HTML da SEFAZ
    normalize.ts          Normalização e similaridade de nomes de produto
    data.ts               Consultas, mutações e regra de recorrência
supabase/schema.sql       Tabelas, view, RLS, RPCs, realtime e grants
tests/                    Testes do parser e do casamento de nomes
```
