"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/AppProvider";
import { QrScanner } from "@/components/QrScanner";
import {
  IconAlert,
  IconCamera,
  IconCheck,
  IconChevronRight,
  IconSpinner,
} from "@/components/Icons";
import { fetchAliases, importPurchase, type ItemResolution } from "@/lib/data";
import { money, quantity, dateTime } from "@/lib/format";
import { normalizeName, rankMatches, suggestProductName } from "@/lib/normalize";
import type { NfceReceipt } from "@/lib/nfce/parse";
import type { ProductWithStats } from "@/lib/types";

type Mode = "idle" | "camera" | "loading" | "review" | "saving" | "done";

type Done = { itemsSaved: number; listItemsCleared: number; purchaseId: string };

/** Acima disso confiamos no palpite e ja deixamos o item ligado ao produto. */
const AUTO_LINK_THRESHOLD = 0.72;

export default function EscanearPage() {
  const { supabase, household, user, products, refresh } = useApp();

  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const [receipt, setReceipt] = useState<NfceReceipt | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<ItemResolution[]>([]);
  const [done, setDone] = useState<Done | null>(null);

  const [aliases, setAliases] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!household) return;
    void fetchAliases(supabase, household.id).then(setAliases).catch(() => {});
  }, [supabase, household]);

  const consult = useCallback(
    async (qr: string) => {
      setMode("loading");
      setError(null);

      try {
        const response = await fetch("/api/nfce", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qr }),
        });

        const payload = await response.json();

        if (!response.ok) {
          setError(payload.error ?? "Não consegui ler essa nota.");
          setMode("idle");
          return;
        }

        setReceipt(payload.receipt);
        setSourceUrl(payload.sourceUrl ?? null);
        setResolutions(defaultResolutions(payload.receipt, products, aliases));
        setMode("review");
      } catch {
        setError("Falha de conexão ao consultar a nota.");
        setMode("idle");
      }
    },
    [products, aliases],
  );

  async function save() {
    if (!receipt || !household || !user) return;

    setMode("saving");
    setError(null);

    try {
      const result = await importPurchase(
        supabase,
        household.id,
        user.id,
        receipt,
        resolutions,
        sourceUrl,
      );
      setDone(result);
      setMode("done");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar a compra.");
      setMode("review");
    }
  }

  function reset() {
    setMode("idle");
    setReceipt(null);
    setResolutions([]);
    setDone(null);
    setError(null);
    setManual("");
  }

  /* ---------------------------------------------------------------------- */

  if (!household) {
    return <p className="py-10 text-sm text-muted">Crie ou entre numa casa primeiro.</p>;
  }

  if (mode === "done" && done) {
    return <DoneScreen done={done} onReset={reset} />;
  }

  if (mode === "review" && receipt) {
    return (
      <ReviewScreen
        receipt={receipt}
        products={products}
        resolutions={resolutions}
        onChange={setResolutions}
        onSave={save}
        onCancel={reset}
        saving={false}
        error={error}
      />
    );
  }

  if (mode === "saving" && receipt) {
    return (
      <ReviewScreen
        receipt={receipt}
        products={products}
        resolutions={resolutions}
        onChange={setResolutions}
        onSave={save}
        onCancel={reset}
        saving
        error={error}
      />
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Escanear nota</h1>
        <p className="text-sm text-muted">
          Leia o QR Code do cupom fiscal para registrar a compra e dar baixa na lista.
        </p>
      </header>

      {mode === "camera" ? (
        <QrScanner onResult={consult} onCancel={() => setMode("idle")} />
      ) : mode === "loading" ? (
        <div className="card flex flex-col items-center gap-3 px-5 py-14">
          <IconSpinner size={24} className="text-muted" />
          <p className="text-sm text-muted">Consultando a SEFAZ…</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode("camera");
            }}
            className="btn-primary w-full"
          >
            <IconCamera size={18} />
            Abrir câmera
          </button>

          {error && (
            <div className="card mt-4 flex gap-3 p-4">
              <IconAlert size={18} className="mt-0.5 shrink-0 text-warn" />
              <p className="text-sm text-muted">{error}</p>
            </div>
          )}

          <div className="mt-8">
            <label htmlFor="manual" className="label">
              Ou cole o link da nota
            </label>
            <div className="flex gap-2">
              <input
                id="manual"
                value={manual}
                onChange={(event) => setManual(event.target.value)}
                placeholder="https://www.nfce.fazenda.sp.gov.br/qrcode?p=…"
                className="field flex-1"
              />
              <button
                type="button"
                disabled={!manual.trim()}
                onClick={() => consult(manual.trim())}
                className="btn-ghost px-4"
              >
                Ler
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Funciona também com a chave de 44 dígitos impressa no cupom.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function defaultResolutions(
  receipt: NfceReceipt,
  products: ProductWithStats[],
  aliases: Map<string, string>,
): ItemResolution[] {
  const productIds = new Set(products.map((product) => product.id));

  return receipt.items.map((item) => {
    // 1. Ja ensinamos esse casamento numa compra anterior.
    const known = aliases.get(normalizeName(item.description));
    if (known && productIds.has(known)) {
      return { action: "link", productId: known };
    }

    // 2. Palpite por similaridade, so quando bem acima do limiar.
    const [best] = rankMatches(
      item.description,
      products,
      (product) => product.name,
      AUTO_LINK_THRESHOLD,
    );
    if (best) return { action: "link", productId: best.item.id };

    // 3. Produto novo no catalogo.
    return { action: "create", name: suggestProductName(item.description) };
  });
}

type ReviewProps = {
  receipt: NfceReceipt;
  products: ProductWithStats[];
  resolutions: ItemResolution[];
  onChange: (next: ItemResolution[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
};

function ReviewScreen({
  receipt,
  products,
  resolutions,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: ReviewProps) {
  const counts = useMemo(() => {
    let linked = 0;
    let created = 0;
    let skipped = 0;
    for (const resolution of resolutions) {
      if (resolution.action === "link") linked += 1;
      else if (resolution.action === "create") created += 1;
      else skipped += 1;
    }
    return { linked, created, skipped };
  }, [resolutions]);

  function update(index: number, resolution: ItemResolution) {
    const next = [...resolutions];
    next[index] = resolution;
    onChange(next);
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Conferir compra</h1>
        <p className="text-sm text-muted">
          {receipt.storeName ?? "Estabelecimento não identificado"}
          {receipt.purchasedAt ? ` · ${dateTime(receipt.purchasedAt)}` : ""}
        </p>
      </header>

      <div className="card flex items-center justify-between px-4 py-3">
        <div>
          <p className="text-xs text-muted">Total da nota</p>
          <p className="text-lg font-semibold">
            {money(receipt.paidAmount ?? receipt.totalAmount)}
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <p>
            {receipt.items.length}{" "}
            {receipt.items.length === 1 ? "item" : "itens"}
          </p>
          <p>
            {counts.linked} reconhecidos · {counts.created} novos
            {counts.skipped > 0 && ` · ${counts.skipped} ignorados`}
          </p>
        </div>
      </div>

      <ul className="card mt-4 divide-y divide-border overflow-hidden">
        {receipt.items.map((item, index) => (
          <ReviewRow
            key={`${item.code ?? item.description}-${index}`}
            description={item.description}
            detail={`${quantity(item.quantity, item.unit)} · ${money(item.unitPrice)} · ${money(item.totalPrice)}`}
            products={products}
            resolution={resolutions[index]}
            onChange={(resolution) => update(index, resolution)}
          />
        ))}
      </ul>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost flex-1">
          Cancelar
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="btn-primary flex-1">
          {saving && <IconSpinner size={16} />}
          {saving ? "Salvando" : "Salvar compra"}
        </button>
      </div>
    </div>
  );
}

type RowProps = {
  description: string;
  detail: string;
  products: ProductWithStats[];
  resolution: ItemResolution | undefined;
  onChange: (resolution: ItemResolution) => void;
};

function ReviewRow({ description, detail, products, resolution, onChange }: RowProps) {
  const current = resolution ?? { action: "skip" as const };

  // Produtos mais parecidos primeiro: evita rolar uma lista enorme no celular.
  const ordered = useMemo(() => {
    const ranked = rankMatches(description, products, (product) => product.name, 0.2);
    const rankedIds = new Set(ranked.map((entry) => entry.item.id));
    return [
      ...ranked.map((entry) => entry.item),
      ...products.filter((product) => !rankedIds.has(product.id)),
    ];
  }, [description, products]);

  const selectValue =
    current.action === "link" ? current.productId : current.action;

  return (
    <li className="px-4 py-3">
      <p className="truncate text-sm">{description}</p>
      <p className="text-xs text-muted">{detail}</p>

      <div className="mt-2 flex items-center gap-2">
        <IconChevronRight size={14} className="shrink-0 text-muted" />

        <select
          value={selectValue}
          aria-label={`Produto para ${description}`}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "create") {
              onChange({ action: "create", name: suggestProductName(description) });
            } else if (value === "skip") {
              onChange({ action: "skip" });
            } else {
              onChange({ action: "link", productId: value });
            }
          }}
          className="field h-9 flex-1 text-sm"
        >
          <option value="create">Criar produto novo</option>
          <option value="skip">Ignorar este item</option>
          {ordered.length > 0 && (
            <optgroup label="Produtos existentes">
              {ordered.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {current.action === "create" && (
        <input
          value={current.name}
          onChange={(event) => onChange({ action: "create", name: event.target.value })}
          aria-label={`Nome do novo produto para ${description}`}
          className="field mt-2 h-9 text-sm"
        />
      )}
    </li>
  );
}

function DoneScreen({ done, onReset }: { done: Done; onReset: () => void }) {
  return (
    <div className="py-6">
      <div className="card p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          <IconCheck size={24} />
        </div>

        <h1 className="mt-4 text-lg font-semibold">Compra registrada</h1>
        <p className="mt-1 text-sm text-muted">
          {done.itemsSaved} {done.itemsSaved === 1 ? "item salvo" : "itens salvos"}
          {done.listItemsCleared > 0 &&
            ` · ${done.listItemsCleared} ${
              done.listItemsCleared === 1 ? "item saiu" : "itens saíram"
            } da lista`}
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <Link href={`/historico/${done.purchaseId}`} className="btn-primary w-full">
            Ver a compra
          </Link>
          <button type="button" onClick={onReset} className="btn-ghost w-full">
            Escanear outra nota
          </button>
        </div>
      </div>
    </div>
  );
}
