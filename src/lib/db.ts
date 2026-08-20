import { Pool, types as pgTypes } from "pg";

/**
 * Conversao de tipos do Postgres para o que a UI espera.
 *
 * Por padrao o driver devolve `numeric` como string (para nao perder precisao)
 * e `timestamptz` como Date. Os tipos do app declaram number e string ISO, e
 * esses valores ainda cruzam a fronteira de serializacao das Server Actions —
 * entao normalizamos aqui, uma vez, em vez de mapear linha a linha.
 *
 * numeric vira float: sao precos e quantidades de supermercado, longe de
 * qualquer limite de precisao do double.
 */
pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (value) => Number(value));

const parseTimestamptz = pgTypes.getTypeParser(pgTypes.builtins.TIMESTAMPTZ);
pgTypes.setTypeParser(pgTypes.builtins.TIMESTAMPTZ, (value) => {
  const parsed = parseTimestamptz(value);
  return parsed instanceof Date ? parsed.toISOString() : value;
});

/**
 * Pool de conexoes com o Postgres do Neon.
 *
 * Em dev o Next recarrega os modulos a cada edicao; sem guardar o pool no
 * globalThis abririamos uma conexao nova a cada hot reload ate estourar o
 * limite do Neon.
 */
const globalForDb = globalThis as unknown as { mercaditoPool?: Pool };

const connectionString = process.env.DATABASE_URL;

const MISSING_DATABASE_URL =
  "DATABASE_URL não definida. Copie .env.local.example para .env.local e cole a " +
  "connection string do Neon (a versão *pooled*, com '-pooler' no host).";

/**
 * O `next build` importa este modulo sem as variaveis de ambiente. Por isso o
 * pool e criado mesmo sem URL e o erro so aparece na primeira consulta — assim
 * o build passa e quem esquecer o .env.local recebe uma mensagem util em vez de
 * um erro de DNS.
 */
function createPool(): Pool {
  return new Pool({
    connectionString: connectionString ?? "postgresql://localhost:5432/inexistente",
    // O Neon hiberna a instancia; poucos sockets e ocioso curto evitam segurar
    // conexao morta depois que ela acorda. O teto e configuravel porque o free
    // tier limita conexoes simultaneas.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
}

function assertConfigured(): void {
  if (!connectionString) throw new Error(MISSING_DATABASE_URL);
}

export const pool: Pool = globalForDb.mercaditoPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.mercaditoPool = pool;
}

/** Consulta tipada. Use sempre parametros ($1, $2) — nunca interpole SQL. */
export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertConfigured();
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/** Primeira linha, ou null. */
export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Roda um bloco dentro de uma transacao, com rollback em caso de erro. */
export async function transaction<T>(
  run: (client: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
  assertConfigured();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

/** Codigo de erro do Postgres, quando houver (23505 = unique_violation). */
export function pgErrorCode(cause: unknown): string | null {
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}
