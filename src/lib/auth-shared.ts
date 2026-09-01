/**
 * Constantes compartilhadas entre o formulario de login (cliente) e o portao de
 * acesso (servidor).
 *
 * Ficam num modulo proprio porque importar auth.ts do cliente arrastaria o
 * Better Auth e o driver do Postgres para o bundle do navegador.
 */

/** Cabecalho onde o formulario manda o codigo de acesso. */
export const ACCESS_CODE_HEADER = "x-codigo-acesso";

/** Onde o codigo fica guardado entre o login e a entrada na casa. */
export const PENDING_CODE_KEY = "mercadito:codigo-pendente";

/**
 * Quantos digitos tem o codigo de acesso rapido.
 *
 * Mora aqui, e nao em pin.ts, porque o formulario tambem precisa dele — e
 * pin.ts importa node:crypto.
 */
export const PIN_LENGTH = 4;

/**
 * Codigo de erro de /codigo/entrar que significa "este aparelho nao entra mais
 * por codigo". A tela de login troca o teclado pelo formulario de e-mail em vez
 * de deixar a pessoa insistindo num codigo que nao vale mais.
 */
export const DEVICE_REJECTED = "APARELHO_RECUSADO";
