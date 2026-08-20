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
