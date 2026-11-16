/**
 * As regras da aba Conta, sem banco e sem sessao — para serem testadas a seco.
 *
 * Quem grava e src/lib/actions.ts; aqui so se decide o que e um valor aceitavel
 * e o que significa "em branco".
 */

export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Limite do proprio padrao de e-mail (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Um endereco so, sem nome na frente. A lista de caracteres proibidos e o que
 * importa: virgula, ponto e virgula, aspas e sinais de menor/maior sao o que
 * transformaria o campo num jeito de mandar o relatorio para varias pessoas ou
 * de mexer no cabecalho do e-mail.
 */
const EMAIL_PATTERN = /^[^\s@<>(),;:"\\]+@[^\s@<>(),;:"\\]+\.[^\s@<>(),;:"\\.]{2,}$/;

/**
 * Para onde o relatorio vai.
 *
 * `null` significa "o e-mail de login" — e e tambem o que se grava quando a
 * pessoa digita o proprio e-mail de login: assim, se um dia ele mudar, o
 * relatorio acompanha em vez de continuar indo para o antigo.
 */
export function parseReportEmail(
  raw: string | null | undefined,
  loginEmail: string,
): Parsed<string | null> {
  const email = (raw ?? "").trim().toLowerCase();

  if (!email || email === loginEmail.trim().toLowerCase()) {
    return { ok: true, value: null };
  }

  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    return {
      ok: false,
      message: "Esse e-mail não parece válido. Use um endereço só, como nome@exemplo.com.",
    };
  }

  return { ok: true, value: email };
}

/**
 * Como a pessoa quer ser chamada (e o nome que abre o relatorio).
 *
 * `null` = em branco: volta a valer o nome da conta.
 */
export function parseDisplayName(raw: string | null | undefined): Parsed<string | null> {
  // Caracteres de controle nao tem o que fazer num nome, e este vai parar no
  // texto de um e-mail.
  const name = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!name) return { ok: true, value: null };

  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `O nome pode ter no máximo ${DISPLAY_NAME_MAX_LENGTH} caracteres.`,
    };
  }

  return { ok: true, value: name };
}
