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

/** Distancia de edicao (Levenshtein): quantas letras trocar, por ou tirar. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/** As letras de `short` aparecem em `long`, na mesma ordem? */
function isSubsequence(short: string, long: string): boolean {
  let index = 0;
  for (const letter of long) {
    if (letter === short[index]) index += 1;
  }
  return index === short.length;
}

function vowelCount(token: string): number {
  return token.replace(/[^AEIOU]/g, "").length;
}

/**
 * Quanto uma palavra escrita na nota (ou digitada) corresponde a uma palavra do
 * nome do produto, de 0 a 1.
 *
 * O cupom escreve do jeito que cabe na linha: corta a palavra ("QUEIJ",
 * "MUSSA"), tira as vogais ("QJO", "FGO") ou usa outra grafia ("MUCARELA").
 * Nenhuma dessas e igual a "QUEIJO" ou "MUSSARELA" letra por letra, e era so
 * isso que a comparacao antiga aceitava.
 *
 * A nota e o resultado so valem como palpite: quanto mais da palavra a
 * abreviacao cobre, mais perto de 1. "MACA" tanto pode ser maca quanto o comeco
 * de "MACARRAO", e por isso um corte curto vale menos que um quase completo.
 */
export function tokenSimilarity(written: string, full: string): number {
  if (written === full) return 1;

  const [short, long] = written.length <= full.length ? [written, full] : [full, written];
  const coverage = short.length / long.length;

  if (long.startsWith(short)) {
    // Singular e plural: "OVO" e "OVOS", "TOMATE" e "TOMATES".
    const rest = long.slice(short.length);
    if (short.length >= 3 && (rest === "S" || rest === "ES")) return 0.95;

    // Palavra cortada: "QUEIJ" -> "QUEIJO", "INTEG" -> "INTEGRAL".
    if (short === written) {
      if (short.length >= 4) return 0.6 + 0.4 * coverage;
      // Tres letras e pouco para afirmar: entra como palpite fraco.
      if (short.length === 3) return 0.6;
      return 0;
    }

    // O contrario — o nome do produto e o comeco da palavra da nota — so vale
    // quando falta quase nada ("Queij" no catalogo e "QUEIJO" na nota). Senao
    // "Maca" casaria com "MACARRAO", "Cafe" com "CAFETEIRA" e "Banana" com
    // "BANANADA".
    return short.length >= 4 && coverage >= 0.8 ? 0.6 + 0.4 * coverage : 0;
  }

  // Abreviacao sem vogais: "QJO" -> "QUEIJO", "FGO" -> "FRANGO". Primeira e
  // ultima letra iguais, e no maximo uma vogal — senao e so outra palavra.
  if (
    short === written &&
    short.length >= 3 &&
    long.length >= short.length + 2 &&
    short[0] === long[0] &&
    short[short.length - 1] === long[long.length - 1] &&
    vowelCount(short) <= 1 &&
    isSubsequence(short, long)
  ) {
    return 0.75;
  }

  // Outra grafia ou erro de digitacao: "MUCARELA" e "MUSSARELA".
  if (short.length >= 5) {
    const closeness = 1 - editDistance(short, long) / long.length;
    if (closeness >= 0.75) return closeness * 0.9;
  }

  return 0;
}

/**
 * Quanto das palavras do lado mais curto aparece no outro, de 0 a 1.
 *
 * Containment em vez de Jaccard: a nota tem palavras a mais (marca, tamanho)
 * que nao deveriam punir o casamento. Cada palavra da nota so pode responder
 * por uma do produto.
 */
function tokenOverlap(written: string[], full: string[]): number {
  const writtenIsShorter = written.length <= full.length;
  const shorter = writtenIsShorter ? written : full;
  const longer = writtenIsShorter ? full : written;

  const used = new Set<number>();
  let total = 0;
  let matched = 0;

  for (const token of shorter) {
    let best = 0;
    let bestIndex = -1;

    longer.forEach((other, index) => {
      if (used.has(index)) return;
      const score = writtenIsShorter
        ? tokenSimilarity(token, other)
        : tokenSimilarity(other, token);
      if (score > best) {
        best = score;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) used.add(bestIndex);
    if (best > 0) matched += 1;
    total += best;
  }

  // Duas palavras batendo dizem mais que uma: sem isso "QUEIJO MUCARELA" ficava
  // com o produto "Queijo" (uma palavra, identica) em vez de "Queijo Mussarela"
  // (duas, uma delas em outra grafia).
  const agreement = 1 + 0.1 * Math.max(0, matched - 1);

  return Math.min(1, (total / shorter.length) * agreement);
}

/**
 * Palavrinhas de ligacao que so atrapalham a comparacao: o cupom escreve
 * "SABAO PO" e o produto se chama "Sabao em po".
 *
 * Ficam fora de STOPWORDS de proposito — aquela lista entra em `normalizeName`,
 * e mudar o que ela devolve mudaria chaves ja gravadas no banco.
 */
const LINKING_WORDS = new Set(["EM", "NO", "NA", "NOS", "NAS", "AO", "AOS", "PARA", "POR"]);

/** As palavras que entram na comparacao. */
function matchTokens(raw: string): string[] {
  const tokens = tokenize(raw);
  const meaningful = tokens.filter((token) => !LINKING_WORDS.has(token));

  // Um nome feito so de palavras de ligacao continua sendo comparado como veio.
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Similaridade entre o que foi escrito (a descricao da nota, ou o que a pessoa
 * esta digitando) e o nome de um produto, de 0 a 1.
 *
 * Combina as palavras em comum — iguais ou abreviadas, veja tokenSimilarity —
 * com a similaridade de caracteres do nome inteiro, que desempata candidatos
 * parecidos.
 *
 * A ordem dos argumentos importa: quem abrevia e o primeiro.
 *
 * Nao mexe em `normalizeName`: aquela chave esta gravada no banco (produtos e
 * apelidos aprendidos) e precisa continuar saindo igual.
 */
export function similarity(written: string, productName: string): number {
  const tokensA = matchTokens(written);
  const tokensB = matchTokens(productName);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const tokenScore = tokenOverlap(tokensA, tokensB);
  const charScore = diceCoefficient(tokensA.join(""), tokensB.join(""));

  return tokenScore * 0.7 + charScore * 0.3;
}

/**
 * Acima disso a tela de conferencia ja deixa o item da nota ligado ao produto;
 * abaixo, o produto so aparece como sugestao e quem decide e a pessoa.
 *
 * Ligar errado custa mais que nao ligar: o apelido fica memorizado e o preco de um
 * produto passa a contar no historico de outro. Por isso uma abreviacao curta de
 * uma palavra so ("LING", "MACA") fica de proposito logo abaixo da linha.
 */
export const AUTO_LINK_THRESHOLD = 0.72;

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
