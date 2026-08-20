/**
 * Aplica neon/schema.sql no banco apontado por DATABASE_URL.
 *
 * Idempotente: o schema usa `create table if not exists` e `create or replace
 * view`, entao rodar de novo depois de uma alteracao e seguro.
 *
 *   npm run db:setup
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const RESET = "[0m";
const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const DIM = "[2m";

function loadEnvLocal() {
  // Este script roda fora do Next, que e quem normalmente carrega o .env.local.
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key] === undefined) {
        process.env[key] = value.trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // sem .env.local: seguimos com o que já estiver no ambiente
  }
}

function fail(message, hint) {
  console.error(`\n${RED}✗ ${message}${RESET}`);
  if (hint) console.error(`${DIM}  ${hint}${RESET}`);
  process.exit(1);
}

function sslFor(url) {
  const host = new URL(url).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  return isLocal ? undefined : { rejectUnauthorized: true };
}

// SSL definido acima; sem isso o driver imprime um aviso de depreciacao.
function stripSslParams(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("channel_binding");
  return parsed.toString();
}

loadEnvLocal();

const url = process.env.DATABASE_URL;

if (!url) {
  fail(
    "DATABASE_URL não está definida.",
    "Crie o .env.local a partir do .env.local.example e cole a connection string do Neon.",
  );
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  fail("DATABASE_URL não parece uma connection string do Postgres.");
}

if (url.includes("ep-xxxx") || url.includes("usuario:senha")) {
  fail(
    "DATABASE_URL ainda está com o valor de exemplo.",
    "Troque pela string real do console do Neon.",
  );
}

const client = new Client({ connectionString: stripSslParams(url), ssl: sslFor(url) });

try {
  await client.connect();
} catch (cause) {
  fail(`Não consegui conectar: ${cause.message}`, "Confira a connection string do Neon.");
}

const { rows: whoami } = await client.query(
  "select current_database() as db, current_user as usuario",
);
console.log(
  `\n${GREEN}✓${RESET} Conectado em ${whoami[0].db} como ${whoami[0].usuario}`,
);

if (!url.includes("-pooler")) {
  console.log(
    `${YELLOW}!${RESET} A connection string não é a *pooled*. Funciona, mas em produção` +
      `\n  prefira a que tem "-pooler" no host — ela aguenta mais conexões simultâneas.`,
  );
}

// O schema referencia "user", criada pelo Better Auth. Sem ela o erro seria um
// "relation does not exist" confuso, então checamos antes.
const { rows: authCheck } = await client.query(
  `select to_regclass('public.user') is not null as ok`,
);

if (!authCheck[0].ok) {
  await client.end();
  fail(
    'A tabela de autenticação "user" ainda não existe.',
    "Rode primeiro:  npx auth@latest migrate\n  Ela cria user, session, account e verification, que este schema referencia.",
  );
}

console.log(`${GREEN}✓${RESET} Tabelas de autenticação encontradas`);

try {
  await client.query(readFileSync("neon/schema.sql", "utf8"));
} catch (cause) {
  await client.end();
  fail(`Falha ao aplicar o schema: ${cause.message}`);
}

const { rows: tables } = await client.query(
  `select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('households','household_members','products','product_aliases',
                         'purchases','purchase_items','list_items')
    order by table_name`,
);

const { rows: views } = await client.query(
  `select table_name from information_schema.views
    where table_schema = 'public' and table_name = 'product_stats'`,
);

console.log(`${GREEN}✓${RESET} Schema aplicado`);
console.log(`${DIM}  tabelas: ${tables.map((t) => t.table_name).join(", ")}${RESET}`);
console.log(`${DIM}  view:    ${views.map((v) => v.table_name).join(", ") || "—"}${RESET}`);

if (tables.length !== 7 || views.length !== 1) {
  await client.end();
  fail("Faltou alguma tabela ou a view product_stats.");
}

console.log(`\n${GREEN}Banco pronto.${RESET} Agora: npm run dev\n`);

await client.end();
