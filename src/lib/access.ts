/**
 * Portao de entrada do app.
 *
 * Sem isso qualquer pessoa que descubra a URL cria uma conta. Ela nao veria a
 * lista de ninguem — o escopo por casa ja garante isso —, mas nao ha motivo
 * para deixar a porta aberta num app de duas pessoas.
 *
 * A regra roda no servidor, dentro do fluxo do Better Auth, e nao no
 * formulario: esconder o campo no cliente nao impede ninguem de chamar a API
 * diretamente.
 */

export type AccessDecision =
  | { allowed: true; reason: "usuario-conhecido" | "primeiro-acesso" | "codigo-valido" }
  | { allowed: false; message: string };

/** Normaliza como o usuario digita: espacos sobrando e caixa trocada. */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Decide se um pedido de link de acesso deve seguir adiante.
 *
 * - Quem já tem conta entra sempre: o código serve para *entrar na casa*, não
 *   para repetir todo login.
 * - Se ainda não existe nenhuma casa, o primeiro acesso é liberado — é quem vai
 *   criar a casa e gerar o código.
 * - Qualquer outra pessoa precisa apresentar o código de uma casa existente.
 */
/**
 * As tres perguntas que a decisao faz ao banco.
 *
 * Injetaveis para que os testes cubram todos os ramos sem precisar de Postgres
 * — esta e a regra que decide quem entra no app.
 */
export type AccessLookups = {
  userExists(email: string): Promise<boolean>;
  householdCount(): Promise<number>;
  codeExists(code: string): Promise<boolean>;
};

export async function decideAccess(
  rawEmail: string | null | undefined,
  rawCode: string | null | undefined,
  lookups: AccessLookups,
): Promise<AccessDecision> {
  const email = normalizeEmail(rawEmail);

  if (!email) {
    return { allowed: false, message: "Informe um e-mail." };
  }

  if (await lookups.userExists(email)) {
    return { allowed: true, reason: "usuario-conhecido" };
  }

  if ((await lookups.householdCount()) === 0) {
    return { allowed: true, reason: "primeiro-acesso" };
  }

  const code = normalizeCode(rawCode);
  if (!code) {
    return {
      allowed: false,
      message:
        "Esta lista é privada. Peça o código de acesso a quem já usa o app e informe no campo abaixo.",
    };
  }

  if (!(await lookups.codeExists(code))) {
    return { allowed: false, message: "Código de acesso inválido." };
  }

  return { allowed: true, reason: "codigo-valido" };
}
