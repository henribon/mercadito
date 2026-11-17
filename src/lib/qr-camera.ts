/**
 * A camera, a foto e a leitura do QR Code, separadas da UI.
 *
 * As tres primeiras decisoes nasceram do mesmo problema: o QR da NFC-e e denso
 * (a URL da SEFAZ tem a chave de 44 digitos), entao os modulos ficam minusculos
 * no cupom.
 *
 * 1. Resolucao. O padrao do getUserMedia e 640x480 — nessa resolucao os modulos
 *    somem antes de o codigo caber na tela, e o unico jeito de ler e chegar tao
 *    perto que a lente nao consegue mais focar. Pedindo 1920x1080 da para ler a
 *    um palmo de distancia, onde a camera foca sem esforco.
 * 2. Foco continuo. Pedido explicitamente na track, quando o aparelho suporta.
 * 3. Leitura continua e rapida. O BarcodeDetector nativo (Chrome no Android)
 *    decodifica em milissegundos; onde ele nao existe (Safari), caimos no ZXing
 *    recortando so o quadrado que aparece na tela.
 * 4. Foto no iPhone. Ali a camera ao vivo pedia permissao a cada leitura (veja
 *    `prefersPhotoCapture`); a foto vem do app de camera do sistema, que nao
 *    pede nada, e e lida por `readQrFromPhoto`.
 */

/** O que pedimos da camera. Tudo `ideal`: nenhum aparelho fica sem imagem. */
export const VIDEO_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/**
 * Teto do quadro que vai para o ZXing.
 *
 * Com 1080p o recorte ja sai em 1080 e o limite nao faz nada. Ele existe para o
 * aparelho que resolve entregar 4K: decodificar 2160x2160 em JavaScript levaria
 * quase um segundo por tentativa.
 */
const MAX_DECODE_SIZE = 1080;

/** Descanso minimo entre duas tentativas, para nao fritar a bateria. */
export const SCAN_INTERVAL_MS = 60;

/* -------------------------------------------------------------------------- */

/** Recorte quadrado centralizado — exatamente o que o `object-cover` mostra. */
export type Crop = { x: number; y: number; size: number };

/**
 * O video chega deitado (1920x1080) e e exibido dentro de um quadrado com
 * `object-cover`, que corta as laterais. Ler o mesmo quadrado que a pessoa ve
 * evita a surpresa de um codigo visivel na tela e ignorado pelo leitor — e, de
 * quebra, joga fora quase metade dos pixels.
 */
export function centerSquare(width: number, height: number): Crop | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;

  const size = Math.min(width, height);

  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size: Math.round(size),
  };
}

/**
 * Pedaco do quadro (`x`..`height`, em pixels da imagem original) e o tamanho com
 * que ele chega ao decodificador (`outWidth` x `outHeight`).
 */
export type Region = {
  x: number;
  y: number;
  width: number;
  height: number;
  outWidth: number;
  outHeight: number;
};

/** Lado maior de cada tentativa na foto: acima disso o ZXing fica lento. */
export const PHOTO_DECODE_SIZE = 1600;

/**
 * As tentativas de leitura de uma foto, da mais ampla para a mais detalhada.
 *
 * A foto do iPhone tem 4032x3024. Inteira, ela precisa encolher para 40% para
 * caber no decodificador, e um QR pequeno vira borrao. Por isso, depois da foto
 * inteira (QR grande, em qualquer canto), vem o quadrado central e depois a
 * metade central — onde a pessoa mirou —, cada vez com mais detalhe.
 *
 * Uma tentativa so entra se enxergar com mais detalhe que a anterior: numa
 * foto pequena a foto inteira ja basta, e repetir o mesmo trabalho so atrasa a
 * resposta de que nao ha QR nenhum.
 */
export function photoRegions(width: number, height: number): Region[] {
  const square = centerSquare(width, height);
  if (!square) return [];

  const half = Math.round(square.size / 2);
  const candidates = [
    { x: 0, y: 0, width, height },
    { x: square.x, y: square.y, width: square.size, height: square.size },
    {
      x: Math.round((width - half) / 2),
      y: Math.round((height - half) / 2),
      width: half,
      height: half,
    },
  ];

  const regions: Region[] = [];
  let detail = 0;

  for (const candidate of candidates) {
    const scale = Math.min(1, PHOTO_DECODE_SIZE / Math.max(candidate.width, candidate.height));
    if (scale <= detail) continue;

    detail = scale;
    regions.push({
      ...candidate,
      outWidth: Math.round(candidate.width * scale),
      outHeight: Math.round(candidate.height * scale),
    });
  }

  return regions;
}

/**
 * No iPhone a leitura padrao e pela foto, nao pela camera ao vivo.
 *
 * Todo navegador do iOS e WebKit, e o WebKit esquece a permissao da camera um
 * minuto depois que ela fecha. No app instalado na tela de inicio nao existe
 * nem a configuracao do Safari para liberar de vez: cada leitura virava um
 * pedido de permissao. A foto passa pelo app de camera do sistema, que nao pede
 * nada a pagina — e ainda chega com o foco e a resolucao da camera de verdade.
 *
 * O iPadOS se apresenta como Mac; o toque e o que o denuncia.
 */
export function prefersPhotoCapture(device: {
  userAgent: string;
  maxTouchPoints?: number;
}): boolean {
  if (/iPhone|iPad|iPod/.test(device.userAgent)) return true;
  return /Macintosh/.test(device.userAgent) && (device.maxTouchPoints ?? 0) > 1;
}

/* -------------------------------------------------------------------------- */

export type QrDetector = {
  /** Qual estrategia foi escolhida. So aparece em log. */
  readonly kind: "native" | "zxing";
  /** Texto do QR, ou null quando nao ha nenhum no quadro. */
  detect: (video: HTMLVideoElement) => Promise<string | null>;
};

/** Le o QR de uma imagem inteira. Null quando nao ha nenhum. */
type NativeReader = (source: CanvasImageSource) => Promise<string | null>;

/** Le o QR de um pedaco da imagem. Null quando nao ha nenhum. */
type RegionReader = (source: CanvasImageSource, region: Region) => string | null;

/** A parte do BarcodeDetector que usamos; ainda nao esta no lib.dom do TS. */
type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

function nativeDetectorCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

/**
 * O leitor nativo quando existe, o ZXing quando nao.
 *
 * A diferenca e grande: o nativo roda no codigo do sistema, aceita o quadro
 * inteiro em alta resolucao e responde em poucos milissegundos. O ZXing faz o
 * mesmo trabalho em JavaScript e cobra por isso — dai o recorte.
 */
export async function createQrDetector(): Promise<QrDetector> {
  const native = await createNativeReader();
  if (native) return { kind: "native", detect: native };

  const read = await createZxingReader();

  return {
    kind: "zxing",
    detect: async (video) => {
      const crop = centerSquare(video.videoWidth, video.videoHeight);
      if (!crop) return null;

      const size = Math.min(crop.size, MAX_DECODE_SIZE);
      return read(video, {
        x: crop.x,
        y: crop.y,
        width: crop.size,
        height: crop.size,
        outWidth: size,
        outHeight: size,
      });
    },
  };
}

/**
 * Le o QR Code de uma foto tirada pelo app de camera do sistema.
 *
 * Primeiro o leitor nativo na foto inteira, quando existe; depois o ZXing em
 * cada tentativa de `photoRegions`. Null quando nenhuma acha o codigo.
 */
export async function readQrFromPhoto(photo: Blob): Promise<string | null> {
  const image = await createImageBitmap(photo);

  try {
    const native = await createNativeReader();
    const found = await native?.(image).catch(() => null);
    if (found) return found;

    const read = await createZxingReader();

    for (const region of photoRegions(image.width, image.height)) {
      const text = read(image, region);
      if (text) return text;

      // Cada tentativa segura a thread por algumas centenas de milissegundos;
      // devolver a vez entre elas deixa o spinner girar.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return null;
  } finally {
    image.close();
  }
}

async function createNativeReader(): Promise<NativeReader | null> {
  const Ctor = nativeDetectorCtor();
  if (!Ctor) return null;

  try {
    // Alguns navegadores expoem a classe mas nao trazem o QR Code entre os
    // formatos suportados; melhor descobrir agora do que no meio da compra.
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;

    const detector = new Ctor({ formats: ["qr_code"] });

    return async (source) => {
      const codes = await detector.detect(source);
      return codes[0]?.rawValue?.trim() || null;
    };
  } catch {
    return null;
  }
}

async function createZxingReader(): Promise<RegionReader> {
  // Import dinamico: quem so quer ver a lista nao baixa o decodificador.
  const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
    import("@zxing/browser"),
    import("@zxing/library"),
  ]);

  // TRY_HARDER faz o localizador varrer todas as linhas do quadro em vez de
  // pular de tres em tres. Custa alguns milissegundos e e o que permite achar
  // um codigo pequeno, longe ou levemente torto.
  const hints = new Map([[DecodeHintType.TRY_HARDER, true]]);
  const reader = new BrowserQRCodeReader(hints);

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return (source, region) => {
    if (!context) return null;

    // Mudar o tamanho do canvas zera o contexto, entao a suavizacao vem depois.
    // Ela importa na foto: encolher 4032 px para 1600 com o filtro padrao
    // serrilha os modulos do QR.
    canvas.width = region.outWidth;
    canvas.height = region.outHeight;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      source,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.outWidth,
      region.outHeight,
    );

    try {
      return reader.decodeFromCanvas(canvas).getText().trim() || null;
    } catch {
      // NotFoundException: nao ha QR no quadro. E o caso comum, nao um erro.
      return null;
    }
  };
}

/* -------------------------------------------------------------------------- */

/** Campos de foco/zoom que os navegadores implementam mas o TS ainda nao tipa. */
type FocusCapabilities = { focusMode?: string[] };
type FocusConstraint = { focusMode?: string };

/**
 * Pede foco continuo. Sem isso o Android costuma travar o foco no primeiro
 * quadro: a pessoa aproxima o cupom e a imagem embaca ate ela desistir.
 *
 * Falhar aqui nao e problema — a camera segue funcionando no modo dela.
 */
export async function requestContinuousFocus(track: MediaStreamTrack): Promise<void> {
  try {
    const capabilities = track.getCapabilities?.() as FocusCapabilities | undefined;
    if (!capabilities?.focusMode?.includes("continuous")) return;

    await track.applyConstraints({
      advanced: [{ focusMode: "continuous" } as FocusConstraint],
    } as MediaTrackConstraints);
  } catch {
    // Constraint recusada: seguimos com o comportamento padrao do aparelho.
  }
}
