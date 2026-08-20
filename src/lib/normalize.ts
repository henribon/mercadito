/**
 * Normalizacao e casamento de nomes de produto.
 *
 * O problema central do app: a nota fiscal escreve "LEITE INTEG ITALAC 1L" e o
 * usuario escreveu "leite integral" na lista. Precisamos reconhecer que sao a
 * mesma coisa sem exigir que ele configure nada.
 */

/** Abreviacoes que aparecem o tempo todo em cupom de supermercado. */
const ABBREVIATIONS: Record<string, string> = {
  ACHOC: "ACHOCOLATADO",
  ACUC: "ACUCAR",
  AMAC: "AMACIANTE",
  BISC: "BISCOITO",
  BEB: "BEBIDA",
  CERV: "CERVEJA",
  CHOC: "CHOCOLATE",
  CX: "CAIXA",
  DET: "DETERGENTE",
  DESOD: "DESODORANTE",
  FRAL: "FRALDA",
  INT: "INTEGRAL",
  INTEG: "INTEGRAL",
  LEIT: "LEITE",
  LIMP: "LIMPADOR",
  MANT: "MANTEIGA",
  MARG: "MARGARINA",
  PAP: "PAPEL",
  PT: "PACOTE",
  PC: "PACOTE",
  PCT: "PACOTE",
  REFRIG: "REFRIGERANTE",
  REFR: "REFRIGERANTE",
  REQ: "REQUEIJAO",
  SAB: "SABAO",
  SABON: "SABONETE",
  SUC: "SUCO",
  TEMP: "TEMPERO",
  YOG: "IOGURTE",
  IOG: "IOGURTE",
};

/** Palavras que nao ajudam a distinguir um produto de outro. */
const STOPWORDS = new Set([
  "DE",
  "DA",
  "DO",
  "DAS",
  "DOS",
  "E",
  "COM",
  "SEM",
  "TIPO",
  "UN",
  "UND",
  "UNID",
  "KG",
  "G",
  "ML",
  "L",
  "LT",
  "PCT",
  "EMB",
]);

/** Remove acentos mantendo as letras base. */
export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Chave canonica de um nome de produto.
 * Maiusculo, sem acento, sem quantidade/embalagem, sem stopwords.
 *
 *   normalizeName("Leite Integral Italac 1L") === "INTEGRAL ITALAC LEITE"
 *
 * Os tokens sao ordenados para que a ordem das palavras nao importe.
 */
export function normalizeName(raw: string): string {
  const tokens = tokenize(raw);
  return [...new Set(tokens)].sort().join(" ");
}

/** Tokens significativos de um nome, ja expandidos e sem ruido. */
export function tokenize(raw: string): string[] {
  const cleaned = stripAccents(raw)
    .toUpperCase()
    // "1,5L", "500G", "200ML", "12X350ML" -> fora, e so embalagem
    .replace(/\b\d+([.,]\d+)?\s?(KG|G|GR|ML|L|LT|UN|UND|CM|MM|X)\b/g, " ")
    .replace(/\b\d+\s?X\s?\d+([.,]\d+)?\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ");

  return cleaned
    .split(" ")
    .map((token) => ABBREVIATIONS[token] ?? token)
    .filter((token) => token.length > 1)
    .filter((token) => !STOPWORDS.has(token))
    // codigos numericos puros nao descrevem o produto
    .filter((token) => !/^\d+$/.test(token));
}

/** Bigramas de caracteres, base do coeficiente de Dice. */
function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) {
    set.add(value.slice(i, i + 2));
  }
  return set;
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }
  return (2 * shared) / (left.size + right.size);
}

/**
 * Similaridade entre duas descricoes, de 0 a 1.
 *
 * Combina sobreposicao de tokens (pega "leite integral" vs "integral leite
 * italac") com similaridade de caracteres (pega erros de digitacao e
 * abreviacoes que nao estao no dicionario).
 */
export function similarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  const shared = tokensA.filter((token) => setB.has(token)).length;
  // Containment em vez de Jaccard: a nota tem tokens extras (marca, tamanho)
  // que nao deveriam punir o casamento.
  const tokenScore = shared / Math.min(tokensA.length, tokensB.length);

  const charScore = diceCoefficient(tokensA.join(""), tokensB.join(""));

  return tokenScore * 0.7 + charScore * 0.3;
}

export type MatchCandidate<T> = { item: T; score: number };

/**
 * Ordena candidatos por similaridade com a consulta, descartando os fracos.
 * `threshold` de 0.55 foi calibrado para sugerir sem inventar demais.
 */
export function rankMatches<T>(
  query: string,
  items: readonly T[],
  getName: (item: T) => string,
  threshold = 0.55,
): MatchCandidate<T>[] {
  return items
    .map((item) => ({ item, score: similarity(query, getName(item)) }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/** Titulo apresentavel a partir de uma descricao gritada pela nota fiscal. */
export function toTitleCase(raw: string): string {
  const lower = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Nome inicial sugerido para um produto novo vindo da nota fiscal.
 * Tira embalagem e codigos, mantem ate 3 palavras significativas:
 *   "LEITE INTEG ITALAC 1L" -> "Leite integral italac"
 */
export function suggestProductName(rawDescription: string): string {
  const tokens = tokenize(rawDescription).slice(0, 3);
  if (tokens.length === 0) return toTitleCase(rawDescription);
  return toTitleCase(tokens.join(" "));
}
