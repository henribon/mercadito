"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { loadSnapshot } from "@/lib/actions";
import { buildSuggestions } from "@/lib/data";
import type {
  AppUser,
  Household,
  ListItemWithProduct,
  ProductWithStats,
  Suggestion,
} from "@/lib/types";

/** De quanto em quanto tempo buscamos mudancas feitas pelo outro celular. */
const POLL_INTERVAL_MS = 15_000;

type AppState = {
  loading: boolean;
  error: string | null;
  user: AppUser | null;
  household: Household | null;
  products: ProductWithStats[];
  pending: ListItemWithProduct[];
  suggestions: Suggestion[];
  refresh: () => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp precisa estar dentro de <AppProvider>");
  return context;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [products, setProducts] = useState<ProductWithStats[]>([]);
  const [pending, setPending] = useState<ListItemWithProduct[]>([]);

  // Descarta respostas fora de ordem: um poll lento nao pode sobrescrever o
  // resultado de um refresh disparado depois dele.
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++requestId.current;

    try {
      const snapshot = await loadSnapshot();
      if (token !== requestId.current) return;

      setUser(snapshot.user);
      setHousehold(snapshot.household);
      setProducts(snapshot.products);
      setPending(snapshot.pending);
      setError(null);
    } catch (cause) {
      if (token !== requestId.current) return;

      const message =
        cause instanceof Error ? cause.message : "Falha ao carregar os dados.";

      // Sessao expirou enquanto o app estava aberto.
      if (message.includes("Não autenticado")) {
        router.replace("/login");
        return;
      }
      setError(message);
    } finally {
      if (token === requestId.current) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Sincronizacao entre os dois celulares.
   *
   * Sem realtime, buscamos periodicamente — mas so com a aba visivel, e sempre
   * ao voltar para ela. Na pratica cobre o caso real (um marca um item no
   * mercado, o outro ve em segundos) sem manter conexao aberta nem gastar
   * bateria com a tela apagada.
   */
  useEffect(() => {
    if (!household) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [household, refresh]);

  const suggestions = useMemo(() => {
    const pendingIds = new Set(pending.map((item) => item.product_id));
    return buildSuggestions(products, pendingIds);
  }, [products, pending]);

  const value = useMemo<AppState>(
    () => ({
      loading,
      error,
      user,
      household,
      products,
      pending,
      suggestions,
      refresh,
    }),
    [loading, error, user, household, products, pending, suggestions, refresh],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
