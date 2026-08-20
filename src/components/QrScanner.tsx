"use client";

import { useEffect, useRef, useState } from "react";

import { IconSpinner, IconX } from "./Icons";

type Props = {
  onResult: (text: string) => void;
  onCancel: () => void;
};

/**
 * Camera lendo o QR Code do cupom.
 *
 * O @zxing/browser e carregado sob demanda (import dinamico) para nao pesar no
 * bundle de quem so quer ver a lista. Exige HTTPS ou localhost por causa do
 * getUserMedia.
 */
export function QrScanner({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "reading" | "error">("starting");
  const [message, setMessage] = useState("");

  // A camera so pode ser montada uma vez. Guardamos o callback numa ref para
  // que uma nova identidade de `onResult` (o catalogo recarregou, por exemplo)
  // nao reinicie o video no meio da leitura.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;

    async function start() {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped || !videoRef.current) return;

        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result || stopped) return;
            stopped = true;
            controls?.stop();
            onResultRef.current(result.getText());
          },
        );

        if (stopped) {
          controls.stop();
          return;
        }
        setStatus("reading");
      } catch (cause) {
        if (stopped) return;
        setStatus("error");
        setMessage(describeCameraError(cause));
      }
    }

    void start();

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="card overflow-hidden">
      <div className="relative aspect-square bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />

        {status === "reading" && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <div className="h-48 w-48 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

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
            Aponte para o QR Code impresso no rodapé do cupom fiscal.
          </p>
        )}
      </div>
    </div>
  );
}

function describeCameraError(cause: unknown): string {
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
