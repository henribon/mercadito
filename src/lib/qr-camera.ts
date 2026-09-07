/**
 * A camera e a leitura do QR Code, separadas da UI.
 *
 * Tres decisoes moram aqui, e todas nasceram do mesmo problema: o QR da NFC-e
 * e denso (a URL da SEFAZ tem a chave de 44 digitos), entao os modulos ficam
 * minusculos no cupom.
 *
 * 1. Resolucao. O padrao do getUserMedia e 640x480 — nessa resolucao os modulos
 *    somem antes de o codigo caber na tela, e o unico jeito de ler e chegar tao
 *    perto que a lente nao consegue mais focar. Pedindo 1920x1080 da para ler a
 *    um palmo de distancia, onde a camera foca sem esforco.
 * 2. Foco continuo. Pedido explicitamente na track, quando o aparelho suporta.
 * 3. Leitura continua e rapida. O BarcodeDetector nativo (Chrome no Android)
 *    decodifica em milissegundos; onde ele nao existe (Safari), caimos no ZXing
 *    recortando so o quadrado que aparece na tela.
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

/* -------------------------------------------------------------------------- */

export type QrDetector = {
  /** Qual estrategia foi escolhida. So aparece em log. */
  readonly kind: "native" | "zxing";
  /** Texto do QR, ou null quando nao ha nenhum no quadro. */
  detect: (video: HTMLVideoElement) => Promise<string | null>;
};

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
  const native = await createNativeDetector();
  return native ?? createZxingDetector();
}

async function createNativeDetector(): Promise<QrDetector | null> {
  const Ctor = nativeDetectorCtor();
  if (!Ctor) return null;

  try {
    // Alguns navegadores expoem a classe mas nao trazem o QR Code entre os
    // formatos suportados; melhor descobrir agora do que no meio da compra.
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    if (!formats.includes("qr_code")) return null;

    const detector = new Ctor({ formats: ["qr_code"] });

    return {
      kind: "native",
      detect: async (video) => {
        const codes = await detector.detect(video);
        return codes[0]?.rawValue?.trim() || null;
      },
    };
  } catch {
    return null;
  }
}

async function createZxingDetector(): Promise<QrDetector> {
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

  return {
    kind: "zxing",
    detect: async (video) => {
      const crop = centerSquare(video.videoWidth, video.videoHeight);
      if (!crop || !context) return null;

      const size = Math.min(crop.size, MAX_DECODE_SIZE);
      canvas.width = size;
      canvas.height = size;
      context.drawImage(
        video,
        crop.x,
        crop.y,
        crop.size,
        crop.size,
        0,
        0,
        size,
        size,
      );

      try {
        return reader.decodeFromCanvas(canvas).getText().trim() || null;
      } catch {
        // NotFoundException: nao ha QR no quadro. E o caso comum, nao um erro.
        return null;
      }
    },
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
