import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_LINK_THRESHOLD,
  normalizeName,
  rankMatches,
  similarity,
  tokenSimilarity,
} from "../src/lib/normalize.ts";

/**
 * Casar a descricao do cupom com o produto do catalogo.
 *
 * O cupom escreve do jeito que cabe na linha — "QUEIJ MUSSA LACTOVALE" — e o
 * produto se chama "Queijo Mussarela". Estes testes fixam os dois lados: o que
 * precisa ser reconhecido e o que so se parece e nao pode ser ligado sozinho.
 */

const CATALOGO = [
  "Queijo Mussarela", "Queijo Prato", "Queijo", "Requeijão", "Leite integral",
  "Leite desnatado", "Leite condensado", "Creme de leite", "Frango", "Linguiça",
  "Presunto", "Macarrão", "Maçã", "Arroz", "Feijão", "Café", "Sal", "Salsicha",
  "Tomate", "Molho de tomate", "Banana", "Pão francês", "Biscoito recheado",
  "Refrigerante", "Cerveja", "Cereja", "Detergente", "Sabão em pó",
  "Papel higiênico", "Papel toalha", "Condicionador", "Farinha de trigo", "Ovos",
];

/** O melhor candidato do catalogo para uma descricao de cupom. */
function melhor(nota: string, catalogo: string[] = CATALOGO) {
  const [best] = rankMatches(nota, catalogo, (nome) => nome, 0.2);
  return best ?? null;
}

/** O produto que a tela de conferencia ja deixaria ligado, ou null. */
function ligaSozinho(nota: string, catalogo: string[] = CATALOGO): string | null {
  const [best] = rankMatches(nota, catalogo, (nome) => nome, AUTO_LINK_THRESHOLD);
  return best?.item ?? null;
}

describe("palavra a palavra", () => {
  test("palavra cortada vale mais quanto mais da palavra ela cobre", () => {
    const quase = tokenSimilarity("QUEIJ", "QUEIJO");
    const metade = tokenSimilarity("MUSSA", "MUSSARELA");
    const pouco = tokenSimilarity("MACA", "MACARRAO");

    assert.ok(quase > metade && metade > pouco, `${quase} > ${metade} > ${pouco}`);
    assert.ok(quase > 0.9);
    assert.ok(pouco >= 0.75);
  });

  test("tres letras e so um palpite fraco, duas nao sao nada", () => {
    assert.equal(tokenSimilarity("MAC", "MACARRAO"), 0.6);
    assert.equal(tokenSimilarity("MA", "MACARRAO"), 0);
  });

  test("abreviacao sem vogais: primeira e ultima letra, na ordem", () => {
    assert.equal(tokenSimilarity("QJO", "QUEIJO"), 0.75);
    assert.equal(tokenSimilarity("FGO", "FRANGO"), 0.75);
    assert.equal(tokenSimilarity("LTE", "LEITE"), 0.75);

    // Palavra inteira que so por acaso cabe dentro de outra nao e abreviacao.
    assert.equal(tokenSimilarity("OVO", "OVINO"), 0, "duas vogais");
    assert.equal(tokenSimilarity("MEL", "MORTADELA"), 0, "ultima letra diferente");
    assert.equal(tokenSimilarity("SAL", "SALSICHAL"), 0.6, "isso e prefixo, e fraco");
  });

  test("outra grafia da mesma palavra", () => {
    assert.ok(tokenSimilarity("MUCARELA", "MUSSARELA") > 0.65);
    assert.ok(tokenSimilarity("ARROS", "ARROZ") > 0.65);
    assert.equal(tokenSimilarity("BATATA", "BANANA"), 0, "duas letras em seis e outra palavra");
    assert.equal(tokenSimilarity("MACA", "MASSA"), 0, "curtas demais para comparar grafia");
  });

  test("singular e plural sao a mesma palavra, nos dois sentidos", () => {
    assert.equal(tokenSimilarity("OVO", "OVOS"), 0.95);
    assert.equal(tokenSimilarity("OVOS", "OVO"), 0.95);
    assert.equal(tokenSimilarity("TOMATES", "TOMATE"), 0.95);
    assert.equal(tokenSimilarity("PAES", "PAO"), 0, "plural irregular fica de fora");
  });

  test("o nome do produto nao vira prefixo de uma palavra maior da nota", () => {
    // Quem abrevia e a nota. No sentido contrario, so quando falta quase nada.
    assert.equal(tokenSimilarity("MACARRAO", "MACA"), 0);
    assert.equal(tokenSimilarity("CAFETEIRA", "CAFE"), 0);
    assert.equal(tokenSimilarity("BANANADA", "BANANA"), 0);
    assert.equal(tokenSimilarity("SALSICHA", "SAL"), 0);
    assert.ok(tokenSimilarity("QUEIJO", "QUEIJ") > 0.9, "produto que nasceu abreviado");
  });
});

describe("descricao de cupom x catalogo", () => {
  test("o caso que motivou tudo: QUEIJ MUSSA LACTOVALE e Queijo Mussarela", () => {
    assert.equal(ligaSozinho("QUEIJ MUSSA LACTOVALE"), "Queijo Mussarela");
  });

  test("entre os queijos, ganha o que bate mais palavras", () => {
    // "Queijo" sozinho bate uma palavra identica; o especifico bate duas.
    assert.equal(ligaSozinho("QUEIJO MUCARELA FATIADO"), "Queijo Mussarela");
    assert.equal(ligaSozinho("QUEIJ PRATO PRESIDENT"), "Queijo Prato");
    assert.equal(melhor("QJO MUSS FAT TIROLEZ KG")?.item, "Queijo Mussarela");
  });

  test("marca e tamanho na nota nao atrapalham", () => {
    assert.equal(ligaSozinho("LEITE INTEG ITALAC 1L"), "Leite integral");
    assert.equal(ligaSozinho("LEITE DESN PIRACANJUBA 1L"), "Leite desnatado");
    assert.equal(ligaSozinho("BISC RECH OREO"), "Biscoito recheado");
    assert.equal(ligaSozinho("PAP HIG NEVE 12UN"), "Papel higiênico");
    assert.equal(ligaSozinho("FAR TRIGO DONA BENTA"), "Farinha de trigo");
    assert.equal(ligaSozinho("REFRIG COCA COLA 2L"), "Refrigerante");
  });

  test("palavra de ligacao no nome do produto nao conta como falta", () => {
    assert.equal(ligaSozinho("SABAO PO OMO 1,6KG"), "Sabão em pó");
    assert.equal(ligaSozinho("MOLHO TOMATE POMAROLA"), "Molho de tomate");
  });

  test("abreviacao curta de uma palavra so vira sugestao, nao ligacao", () => {
    // O primeiro da lista e o certo, mas quem confirma e a pessoa.
    for (const [nota, produto] of [
      ["LING TOSCANA PERDIGAO", "Linguiça"],
      ["PRES COZ SADIA", "Presunto"],
      ["FGO CONG SADIA KG", "Frango"],
      ["FEIJ CARIOCA CAMIL 1KG", "Feijão"],
      ["COND PANTENE 400ML", "Condicionador"],
      ["LTE COND MOCA 395G", "Leite condensado"],
    ]) {
      assert.equal(melhor(nota)?.item, produto, nota);
      assert.equal(ligaSozinho(nota), null, `${nota} foi ligado sozinho`);
    }
  });

  test("o que ja era reconhecido continua sendo", () => {
    assert.equal(ligaSozinho("ARROZ TIO JOAO T1 5KG"), "Arroz");
    assert.equal(ligaSozinho("CAFE PILAO 500G"), "Café");
    assert.equal(ligaSozinho("SAL REFINADO CISNE 1KG"), "Sal");
    assert.equal(ligaSozinho("SALSICHA HOT DOG SADIA"), "Salsicha");
    assert.equal(ligaSozinho("CERV SKOL LT 350ML"), "Cerveja");
    assert.equal(ligaSozinho("DET LIQ YPE NEUTRO 500ML"), "Detergente");
    assert.equal(ligaSozinho("OVOS BRANCOS 12UN"), "Ovos");
    assert.equal(ligaSozinho("MACA FUJI KG"), "Maçã");
    assert.equal(ligaSozinho("MACARRAO PARAF RENATA"), "Macarrão");
  });

  test("o que nao esta no catalogo nao e empurrado para um produto", () => {
    assert.equal(ligaSozinho("SACOLA PLASTICA"), null);
    assert.equal(ligaSozinho("PILHA DURACELL AA"), null);
    assert.equal(ligaSozinho("CAFETEIRA ELETRICA"), null);
  });
});

describe("armadilhas: parecido nao e igual", () => {
  // Cada par e uma nota e o UNICO produto parecido que a casa tem. Ligar aqui
  // seria gravar o preco de uma coisa no historico de outra.
  const pares: [string, string][] = [
    ["MACA FUJI KG", "Macarrão"],
    ["MACARRAO PARAF RENATA", "Maçã"],
    ["SAL GROSSO CISNE", "Salsicha"],
    ["SALSICHA HOT DOG", "Sal"],
    ["PAO FRANCES KG", "Frango"],
    ["CAFETEIRA ELETRICA", "Café"],
    ["CERVEJA SKOL LATA", "Cereja"],
    ["LINGUA BOVINA KG", "Linguiça"],
    ["PRESTOBARBA GILLETTE", "Presunto"],
    ["MORTEIN INSETICIDA", "Mortadela"],
    ["CREME DENTAL COLGATE", "Creme de leite"],
    ["LEITE COCO SOCOCO", "Leite integral"],
    ["COND PANTENE 400ML", "Leite condensado"],
    ["SABONETE DOVE", "Sabão em pó"],
    ["PAPEL ALUMINIO WYDA", "Papel higiênico"],
    ["OLEO MOTOR LUBRAX", "Óleo de soja"],
    ["FARINHA ROSCA", "Farinha de trigo"],
    ["BANANADA TACHAO", "Banana"],
    ["ARROZ TIO JOAO T1 5KG", "Sabão em pó"],
  ];

  for (const [nota, produto] of pares) {
    test(`${nota} nao e ligado sozinho a ${produto}`, () => {
      const score = similarity(nota, produto);
      assert.ok(score < AUTO_LINK_THRESHOLD, `pontuou ${score.toFixed(2)}`);
    });
  }
});

describe("o que esta gravado no banco nao muda", () => {
  // products.norm_name e product_aliases.raw_norm guardam o que normalizeName
  // devolve. Se a chave de um texto mudar, o app deixa de achar o produto e o
  // apelido que ja aprendeu — por isso a comparacao nova nao passa por aqui.
  test("normalizeName devolve as mesmas chaves de sempre", () => {
    assert.equal(normalizeName("QUEIJ MUSSA LACTOVALE"), "LACTOVALE MUSSA QUEIJ");
    assert.equal(normalizeName("Sabão em pó"), "EM PO SABAO");
    assert.equal(normalizeName("LEITE INTEG ITALAC 1L"), "INTEGRAL ITALAC LEITE");
    assert.equal(normalizeName("QJO MUSS FAT TIROLEZ KG"), "FAT MUSS QJO TIROLEZ");
    assert.equal(normalizeName("Ovos"), "OVOS");
  });
});

describe("digitando na lista", () => {
  test("o comeco da palavra ja acha o produto", () => {
    // AddItemForm mostra o que pontua 0.4 ou mais.
    assert.ok(similarity("quei", "Queijo Mussarela") >= 0.4);
    assert.ok(similarity("muss", "Queijo Mussarela") >= 0.4);
    assert.ok(similarity("lei", "Leite integral") >= 0.4);
  });
});
