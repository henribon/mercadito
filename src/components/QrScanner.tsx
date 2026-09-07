"use client";

import { useEffect, useRef, useState } from "react";

import {
  SCAN_INTERVAL_MS,
  VIDEO_CONSTRAINTS,
  createQrDetector,
  requestContinuousFocus,
} from "@/lib/qr-camera";
import { IconSpinner, IconX } from "./Icons";

type Props = {
  onResult: (text: string) => void;
  onCancel: () => void;
};

/** Depois disso sem achar nada, a dica de enquadramento aparece. */
const HINT_AFTER_MS = 7000;

/**
 * Camera lendo o QR Code do cupom.
 *
 * Nao existe botao de capturar: o laco tenta decodificar quadro a quadro e
 * dispara `onResult` no instante em que o codigo aparece. A camera e a
 * decodificacao vivem em `lib/qr-camera.ts`; aqui fica so o ciclo de vida do
 * stream e a tela.
 */
export function QrScanner({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "reading" | "error">("starting");
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState(false);

  // A camera so pode ser montada uma vez. Guardamos o callback numa ref para
  // que uma nova identidade de `onResult` (o catalogo recarregou, por exemplo)
  // nao reinicie o video no meio da leitura.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    /** Solta a camera: sem isso o LED fica aceso e a track segura o aparelho. */
    function release() {
      for (const track of stream?.getTracks() ?? []) track.stop();
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("getUserMedia indisponível neste navegador.");
        }

        stream = await navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS);

        const video = videoRef.current;
        if (cancelled || !video) return release();

        const [track] = stream.getVideoTracks();
        if (track) await requestContinuousFocus(track);

        video.srcObject = stream;
        await video.play();
        await waitForFirstFrame(video);
        if (cancelled) return release();

        const detector = await createQrDetector();
        if (cancelled) return release();

        setStatus("reading");

        // Laco proprio em vez do `decodeFromConstraints` do ZXing: aquele
        // espera meio segundo entre uma tentativa e outra, tempo de sobra para
        // a pessoa concluir que o app nao viu o codigo e comecar a aproximar o
        // celular — justamente o movimento que tira a nota de foco.
        while (!cancelled) {
          const started = performance.now();

          const text =
            video.readyState >= video.HAVE_CURRENT_DATA
              ? await detector.detect(video).catch(() => null)
              : null;

          if (cancelled) return;

          if (text) {
            release();
            onResultRef.current(text);
            return;
          }

          await sleep(Math.max(0, SCAN_INTERVAL_MS - (performance.now() - started)));
        }
      } catch (cause) {
        release();
        // Desmontou no meio (o React monta duas vezes em dev): nao ha tela para
        // avisar, e o erro e so o efeito colateral do proprio cancelamento.
        if (cancelled) return;

        setStatus("error");
        setMessage(describeCameraError(cause));
      }
    }

    void start();

    return () => {
      cancelled = true;
      release();
    };
  }, []);

  useEffect(() => {
    if (status !== "reading") return;

    const timer = setTimeout(() => setHint(true), HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-square bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          autoPlay
          muted
        />

        {status === "reading" && <Viewfinder />}

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80">
            <IconSpinner size={24} />
          </div>
        )}

        <button
          type="button"
          onClick={onCancel}
          aria-label="Fechar câmera"
          className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white backdrop-blur"
        >
          <IconX size={18} />
        </button>
      </div>

      <div className="px-4 py-3">
        {status === "error" ? (
          <p className="text-sm text-danger">{message}</p>
        ) : (
          <p className="text-xs text-muted">
            {hint
              ? "Nada ainda. Afaste o celular até o QR Code inteiro caber na tela — de perto a lente não consegue focar."
              : "Aponte para o QR Code do cupom. A leitura é automática."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Cantos em vez de uma janela recortada: a leitura usa todo o quadrado visivel,
 * entao escurecer a volta prometeria uma area util menor do que a real.
 */
function Viewfinder() {
  const corner = "absolute h-8 w-8 border-white/80";

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute inset-[12%]">
        <div className={`${corner} left-0 top-0 rounded-tl-lg border-l-2 border-t-2`} />
        <div className={`${corner} right-0 top-0 rounded-tr-lg border-r-2 border-t-2`} />
        <div className={`${corner} bottom-0 left-0 rounded-bl-lg border-b-2 border-l-2`} />
        <div className={`${corner} bottom-0 right-0 rounded-br-lg border-b-2 border-r-2`} />
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera o primeiro quadro de verdade.
 *
 * `play()` resolve antes de `videoWidth` existir, e sem essas medidas o recorte
 * nao tem como saber o tamanho do quadro.
 */
async function waitForFirstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= video.HAVE_CURRENT_DATA) return;

  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("loadeddata", done);
      resolve();
    };
    video.addEventListener("loadeddata", done);
    // Rede de seguranca: nenhum quadro em 3s cai no laco assim mesmo, que
    // simplesmente ignora as tentativas ate o video ficar pronto.
    setTimeout(done, 3000);
  });
}

export function describeCameraError(cause: unknown): string {
  const name = cause instanceof Error ? cause.name : "";

  if (name === "NotAllowedError") {
    return "Permissão de câmera negada. Libere o acesso nas configurações do navegador.";
  }
  if (name === "NotFoundError") {
    return "Nenhuma câmera encontrada neste aparelho.";
  }
  if (name === "NotReadableError") {
    return "A câmera está sendo usada por outro aplicativo.";
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "A câmera só funciona em HTTPS. Acesse o app pelo endereço seguro.";
  }
  return "Não consegui abrir a câmera. Você pode colar o link da nota abaixo.";
}
