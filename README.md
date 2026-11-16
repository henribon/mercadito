# Mercadito

Lista de mercado compartilhada entre duas pessoas, com histórico de compras lido
direto do QR Code do cupom fiscal (NFC-e de São Paulo).

- **O que falta comprar** — lista única, compartilhada entre os dois celulares.
- **O que já compramos** — escaneia o QR do cupom e importa itens, quantidades e preços.
- **Última vez comprado** — cada produto guarda data, preço e frequência.
- **Lembrete de reposição** — marque um produto como "compramos sempre" e ele
  reaparece na lista quando passa do intervalo de costume.
- **Resumo do mês** — quanto saiu, em quais mercados, onde cada produto sai mais
  barato e o que mais se repete na despesa.
- **Relatório mensal por e-mail** — no começo de cada mês chega o fechamento do
  mês anterior: itens mais caros, no que mais se gastou, onde saiu mais barato e
  a melhor época para comprar o que se repete.
- **Entrar com senha** — depois do primeiro acesso por e-mail, cada um cria a
  própria senha dentro do app e entra em qualquer aparelho com e-mail + senha.
  Quem entrou uma vez fica conectado: a sessão vale um ano e se renova sozinha.
- **Entrar com 4 dígitos** — atalho opcional por aparelho, no lugar da senha.
- **Aba Conta** — cada pessoa ajusta o próprio nome, para qual e-mail o
  relatório vai, a senha e o código de 4 dígitos, e encontra o código de convite
  da casa.

Custo zero: o plano gratuito do Neon permite 100 projetos e a Vercel hospeda o
app de graça.

---

## Stack

| Camada | Escolha |
| --- | --- |
| App | Next.js 15 (App Router) + React 19 + TypeScript |
| Estilo | Tailwind CSS v4, tema claro/escuro automático |
| Banco | Neon (Postgres serverless) via `pg` |
| Autenticação | Better Auth: magic link, senha e código de 4 dígitos |
| Acesso a dados | Server Actions — o banco nunca é exposto ao navegador |
| Leitura do QR | `@zxing/browser` (carregado sob demanda) |
| Leitura da nota | Rota `/api/nfce` no servidor + `cheerio` (QR Code ou página colada) |

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

Ao entrar, crie a casa. O código de convite aparece na aba **Conta** — é ele que
sua esposa usa para entrar na mesma lista.

Ainda na aba **Conta**, em *Entrar no app*, crie sua **senha**. A partir daí
a tela de login aceita e-mail + senha em qualquer aparelho — inclusive no app
instalado na tela inicial, onde o link do e-mail abriria no navegador. Depois de
entrar, o aparelho fica conectado; a senha só volta a ser pedida se você tocar
em *Sair*.

No mesmo lugar dá para criar um **código de 4 dígitos**, que é um atalho só
daquele aparelho: a tela de login passa a mostrar o teclado numérico.

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

> **Ao atualizar um app que já está no ar**, rode `npm run db:setup` de novo
> apontando para o banco de produção sempre que o [`neon/schema.sql`](neon/schema.sql)
> mudar. A senha (`user_passwords`), o relatório mensal (`report_deliveries` e a
> coluna `monthly_report`) e a aba Conta (coluna `report_email`) dependem disso;
> sem elas, criar senha, abrir a aba Conta e enviar relatório falham com o aviso
> de banco desatualizado.

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

## 7. Relatório mensal por e-mail

O relatório usa o mesmo SMTP do link de acesso (passo 5) e é disparado pelo
agendador da Vercel, configurado em [`vercel.json`](vercel.json): nos dias 1, 2
e 3 de cada mês, às 11h UTC (8h em São Paulo), ele chama
`/api/cron/relatorio-mensal`.

Falta só uma variável, na Vercel (**Settings → Environment Variables**):

```env
CRON_SECRET=<openssl rand -hex 32>
```

A Vercel manda esse valor sozinha no cabeçalho `Authorization` de cada chamada
agendada. Sem ele a rota recusa tudo — uma URL pública que dispara e-mails não
pode ficar aberta. O fuso que define onde o mês começa é `America/Sao_Paulo`;
para mudar, defina `REPORT_TIMEZONE`.

Três dias em vez de um porque o envio é idempotente: cada pessoa recebe um
relatório por mês (tabela `report_deliveries`), então os dias 2 e 3 só completam
o que tiver falhado no dia 1.

Cada pessoa liga ou desliga o próprio recebimento na aba **Conta**, em
*Relatório por e-mail*, e escolhe ali para qual endereço ele vai — em branco, é
o e-mail de login. Trocar o destino não muda o e-mail com que se entra no app.
Na aba **Resumo**, o botão **Enviar agora** manda na hora o relatório do mês que
estiver na tela, para o mesmo endereço — é o jeito de ver como ele fica sem
esperar a virada.

Para reenviar um mês pela linha de comando (só chega para quem ainda não
recebeu):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://SEU-APP.vercel.app/api/cron/relatorio-mensal?mes=2026-10"
```

## 8. Instalar no celular

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

**Compraram.** Na aba *Escanear*, aponte a câmera para o QR Code no rodapé do
cupom — não há botão de capturar, a leitura acontece sozinha assim que o código
aparece no quadro. O app consulta a SEFAZ, lista os itens e mostra a qual produto
cada linha será ligada. Você confere, ajusta o que estiver errado e salva. Tudo
que estava na lista e apareceu na nota sai da lista automaticamente.

**Quando a SEFAZ recusa a consulta.** Desde novembro/2026 o portal bloqueia boa
parte das consultas automáticas (veja [Sobre a leitura da nota
fiscal](#sobre-a-leitura-da-nota-fiscal)). Quando isso acontece o app guarda o
link do QR Code e mostra o botão **Abrir a nota na SEFAZ** — no navegador ela
carrega normalmente. Selecione tudo (`Ctrl+A` no desktop, toque longo →
*Selecionar tudo* no celular), copie e volte para o app: ele lê a página copiada
sozinho e segue para a mesma tela de conferência. Na primeira vez o navegador
pede permissão para ler a área de transferência; no iPhone a leitura só acontece
com um toque, em **Ler a página copiada**. O campo **Ou cole o conteúdo da
nota** continua lá para quem preferir colar na mão.

**O app aprende.** Ao confirmar que `LEITE INTEG ITALAC 1L` é o produto
"Leite integral", esse apelido fica salvo. Na próxima nota do mesmo mercado o
casamento é automático.

**Reposição.** Na aba *Produtos*, abra um item e ligue *Compramos sempre*. O
intervalo já vem preenchido com a média real do seu histórico. Quando passar
desse prazo, o produto aparece em **Hora de repor** no topo da lista.

**No fim do mês.** A aba *Resumo* mostra o total gasto e a variação em relação ao
mês anterior, quanto foi para cada mercado, em quais produtos cada mercado sai
mais barato e o que mais se repete na despesa. No começo do mês seguinte, o
relatório completo chega por e-mail.

---

## Decisões de arquitetura

**Quem entra no app.** Pedir um link de acesso exige um código, validado no
servidor pelo hook `before` do Better Auth em [`src/lib/auth.ts`](src/lib/auth.ts).
A regra está em [`src/lib/access.ts`](src/lib/access.ts):

- quem já tem conta entra sempre, sem repetir o código;
- se ainda não existe nenhuma casa, o primeiro acesso é liberado — é quem vai
  criar a casa e gerar o código;
- qualquer outra pessoa precisa apresentar o código de convite de uma casa.

O código é o mesmo que aparece na aba Conta: ele autoriza a entrada **e**
define em qual casa a pessoa cai. Quem entra com ele é adicionado à casa
automaticamente, sem passar por tela de onboarding.

A validação é no servidor de propósito: esconder o campo no formulário não
impediria ninguém de chamar a API diretamente.

**Entrar sem e-mail, com 4 dígitos.** O magic link é ótimo para a primeira vez e
péssimo para todo dia: abrir o e-mail no meio do mercado é atrito. Depois de
entrar uma vez, cada pessoa cria um código de 4 dígitos na aba Conta.

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

**Senha, para qualquer aparelho.** O código de 4 dígitos só vale num aparelho
que já entrou uma vez — e o app instalado na tela inicial é um "aparelho" que
nunca entra, porque o link do e-mail abre no navegador, não nele. A senha cobre
isso: é criada dentro do app, por quem já está logado, e vale com o e-mail em
qualquer lugar.

Aqui não há cookie de aparelho segurando a porta, então quem segura é o limite
de tentativas **por conta**: cinco erros seguidos trancam a senha por 15
minutos, de qualquer IP, e depois disso cada erro novo tranca de novo. O link
por e-mail continua funcionando durante a tranca, então o dono nunca fica do
lado de fora — e trocar a senha (logado) destranca. E-mail desconhecido, conta
sem senha e senha errada devolvem a mesma resposta. A senha é guardada com
`scrypt`, como o código.

Não é o `emailAndPassword` do Better Auth de propósito: a conta continua
nascendo só pelo link por e-mail, atrás do código de convite, e a senha é mais
uma chave para a mesma porta. A regra está em
[`src/lib/password.ts`](src/lib/password.ts) e os endpoints em
[`src/lib/password-plugin.ts`](src/lib/password-plugin.ts).

**Entrou, fica dentro.** A sessão vale um ano e se renova a cada dia de uso, em
cookie httpOnly. Só volta à tela de login quem tocar em *Sair* ou passar um ano
sem abrir o app.

**O relatório é calculado fora do SQL.** Duas consultas trazem as compras e os
itens crus de doze meses e a conta é feita em
[`src/lib/report.ts`](src/lib/report.ts). Metade do relatório depende do dia
*local* da compra (em que parte do mês, em que dia da semana), e o servidor
roda em UTC — com o fuso como parâmetro de uma função pura, a virada do dia é
testada sem banco.

**"Melhor época" compara dentro do mesmo mercado.** Quem faz a compra grande do
começo do mês no atacado e passa no mercado caro no fim concluiria, pelo preço
cru, que "o começo do mês é mais barato" — quando a diferença é de loja. Por
isso cada compra é comparada com a média do produto *naquele mercado*, um
recorte só entra com compras repetidas, e diferença abaixo de 5% é tratada como
acaso. O relatório mostra quantas compras sustentam cada conclusão.

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

**A câmera pede resolução, não proximidade.** O padrão do `getUserMedia` é
640x480, e o QR da NFC-e é denso demais para isso: os módulos somem antes de o
código caber na tela, e o único jeito de ler seria chegar tão perto que a lente
não consegue mais focar. O app pede 1920x1080 e foco contínuo, e faz a leitura
quadro a quadro em vez de esperar meio segundo entre tentativas — assim o cupom
é lido a um palmo de distância, onde a câmera foca sem esforço. Onde existe
`BarcodeDetector` nativo (Chrome no Android) ele é usado; no resto, o ZXing
decodifica só o quadrado que aparece na tela. Está em
[`src/lib/qr-camera.ts`](src/lib/qr-camera.ts).

**O mês começa no celular, não no servidor.** O resumo recebe as datas de início
e fim já prontas do cliente ([`monthWindow`](src/lib/data.ts)). Se o recorte
fosse feito no servidor, que roda em UTC, a compra das 22h do dia 31 cairia no
mês seguinte. Quem sabe onde o mês começa é o aparelho de quem está olhando.

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

**Mudança no portal (novembro/2026):** a Consulta Pública por QR Code passou a
ficar atrás de um WAF. Para requisição que não vem de um navegador de verdade
ele responde **HTTP 200 com uma página de rejeição** de ~250 bytes
(`Request Rejected` + `support ID`) em vez da nota — ou seja, o status não
denuncia nada, só o corpo. Na prática a consulta automática feita pelo servidor
(o que a rota `/api/nfce` faz) falha na maior parte das tentativas, inclusive
rodando da máquina de casa; não é questão do IP da Vercel.

Quando a requisição passa, o portal também mudou de forma: o texto do erro **não
vem no HTML**. Os `div`s de mensagem chegam vazios e o erro é injetado por
JavaScript inline no fim da página:

```js
$('#spnErroProsseguirMaster').html('<ul><li>Problemas na consulta via QR Code …</li></ul>');
```

`detectSefazError` reconhece os dois casos e mostra o motivo real ao usuário,
com link para abrir a nota no navegador (lá a página carrega normal). Antes,
qualquer um dos dois caía na mensagem genérica "não encontrei itens, talvez o
layout tenha mudado".

O caminho que continua funcionando é o usuário copiar a página aberta no próprio
navegador e colar no app: `POST /api/nfce` aceita `{ paste }` e
`parseNfcePaste` lê tanto o HTML quanto o texto renderizado. No texto não há
classes para ancorar, então `parseNfceText` se apoia nos rótulos que o portal
imprime (`(Código: …)`, `Qtde.:`, `UN:`, `Vl. Unit.:`), aceita o valor da linha
na mesma linha ou na seguinte (depende de como o navegador copia a tabela) e
confere o dígito verificador da chave para não confundi-la com outro número
longo da página.

Depois de um QR Code recusado, a tela encurta esse caminho: guarda o link, abre
a nota num toque e, quando a pessoa volta com a página copiada, lê a área de
transferência sozinha (`visibilitychange` + `focus`). Só sai do aparelho o que
tem cara de cupom (`looksLikeNfce`, em [`src/lib/nfce/copied.ts`](src/lib/nfce/copied.ts))
— a área de transferência pode ter qualquer outra coisa. A página vai junto do
QR lido (`{ paste, qr }`): a rota confere que a chave de acesso é a mesma, para
ninguém lançar a nota de ontem que ficou aberta na outra aba, e registra a chave
e o link de origem como numa consulta normal. O navegador não consegue buscar a
página por conta própria — o portal não envia CORS —, então copiar continua
sendo um gesto da pessoa.

**Por que não um navegador headless:** o bloqueio é um desafio JavaScript — passar
por ele é justamente o que o portal decidiu barrar, além de frágil e caro de
hospedar. Se um dia a leitura de um toque for necessária de volta, o caminho
limpo é uma API de consulta de NFC-e de terceiro.

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

São 197 testes em sete frentes:

- **Parsing e casamento de nomes** — HTML da SEFAZ, números e datas em formato
  brasileiro, validação da chave de acesso, similaridade de nomes de produto.
- **Portão de acesso** — quem pode pedir um link de entrada: usuário conhecido,
  primeiro acesso de todos, código certo, código errado e código ausente.
- **Código de 4 dígitos** — o par aparelho + código: hash e conferência, cookie
  de outro aparelho, código de quem já removeu o dele, e as tentativas até o
  aparelho perder a confiança.
- **Senha** — hash e conferência, a mesma resposta para e-mail desconhecido e
  senha errada, as tentativas até a tranca e a tranca valendo até para a senha
  certa.
- **Relatório mensal** — o mês recortado no fuso de São Paulo (incluindo a
  compra das 23h do dia 31 e o horário de verão de outros fusos), cada seção do
  relatório, a "melhor época" sem confundir data com mercado, e o e-mail em si,
  com nome de produto hostil escapado no HTML.
- **Resumo de gastos** — o recorte do mês no fuso local (incluindo a virada do
  ano), a comparação de preço entre mercados e o placar de quem é mais barato.
  Junto vai a geometria do recorte da câmera.
- **Banco de dados** — o schema e as consultas de produção rodam contra um
  Postgres real ([PGlite](https://pglite.dev), Postgres compilado para WASM),
  sem precisar de banco remoto. Cobre a matemática do `product_stats`, o índice
  que impede item duplicado na lista, os cascades, o isolamento entre casas e as
  agregações do resumo, a tranca da senha e a reserva que impede o relatório de
  ser enviado duas vezes.

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
    resumo/               Gasto do mês, mercados, preços, reincidência e "enviar agora" do relatório
    produtos/             Catálogo e recorrência
    conta/                Nome, destino do relatório, senha, código de acesso, convite e sair
    api/auth/[...all]/    Rotas do Better Auth
    api/cron/relatorio-mensal/  Gatilho do relatório (agendador da Vercel)
    api/nfce/             Proxy autenticado para o portal da SEFAZ
  components/             Provider com polling, tab bar, scanner, ícones, PinInput
  components/account/     Cartões de senha e de código de 4 dígitos (aba Conta)
  lib/
    actions.ts            Server Actions: toda a camada de dados
    session.ts            Fronteira de segurança (sessão -> casa)
    account.ts            Regras da aba Conta: nome e e-mail de destino do relatório
    sql.ts                Consultas SQL, compartilhadas com os testes
    db.ts                 Pool do Postgres e conversão de tipos
    auth.ts               Better Auth (magic link + senha + código de 4 dígitos)
    password.ts           Regra da senha e da tranca por tentativas
    password-plugin.ts    Endpoints /api/auth/senha/* (plugin do Better Auth)
    pin.ts                Regra e criptografia do código de 4 dígitos
    pin-plugin.ts         Endpoints /api/auth/codigo/* (plugin do Better Auth)
    email.ts              Envio do link e do relatório via SMTP
    report.ts             Relatório mensal: datas no fuso e toda a conta
    report-email.ts       O relatório em HTML e texto
    report-run.ts         Busca os dados, monta e envia (automático e manual)
    nfce/qr.ts            Interpreta o conteúdo do QR e valida a chave
    nfce/parse.ts         Extrai itens e totais do HTML ou do texto colado
    nfce/copied.ts        Página copiada após o bloqueio: o que enviar e se é a mesma nota
    normalize.ts          Normalização e similaridade de nomes de produto
    qr-camera.ts          Constraints da câmera e leitura do QR (nativo/ZXing)
    data.ts               Regras puras: recorrência, sugestões e comparação de preços
neon/schema.sql           Tabelas, índices e a view de estatísticas
scripts/db-setup.mjs      Aplica o schema no banco (npm run db:setup)
vercel.json               Agendamento do relatório mensal
tests/                    Parser, normalização, acesso, senha, conta, resumo, relatório e banco (PGlite)
```
