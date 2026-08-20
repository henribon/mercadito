"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import {
  buildSuggestions,
  fetchHousehold,
  fetchPendingItems,
  fetchProducts,
} from "@/lib/data";
import type {
  Household,
  ListItemWithProduct,
  ProductWithStats,
  Suggestion,
} from "@/lib/types";

type AppState = {
  loading: boolean;
  error: string | null;
  user: User | null;
  household: Household | null;
  products: ProductWithStats[];
  pending: ListItemWithProduct[];
  suggestions: Suggestion[];
  supabase: SupabaseClient;
  refresh: () => Promise<void>;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp precisa estar dentro de <AppProvider>");
  return context;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // O cliente precisa ser estavel entre renders para o realtime nao reconectar.
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [products, setProducts] = useState<ProductWithStats[]>([]);
  const [pending, setPending] = useState<ListItemWithProduct[]>([]);

  // Evita corrida entre um refresh manual e outro disparado pelo realtime.
  const refreshToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++refreshToken.current;

    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (token !== refreshToken.current) return;
      setUser(currentUser);

      if (!currentUser) {
        setHousehold(null);
        setProducts([]);
        setPending([]);
        return;
      }

      const currentHousehold = await fetchHousehold(supabase);
      if (token !== refreshToken.current) return;
      setHousehold(currentHousehold);

      if (!currentHousehold) {
        setProducts([]);
        setPending([]);
        return;
      }

      const nextProducts = await fetchProducts(supabase, currentHousehold.id);
      const nextPending = await fetchPendingItems(
        supabase,
        currentHousehold.id,
        nextProducts,
      );

      if (token !== refreshToken.current) return;
      setProducts(nextProducts);
      setPending(nextPending);
      setError(null);
    } catch (cause) {
      if (token !== refreshToken.current) return;
      setError(cause instanceof Error ? cause.message : "Falha ao carregar os dados.");
    } finally {
      if (token === refreshToken.current) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();

    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void load();
    });

    return () => authListener.subscription.unsubscribe();
  }, [load, supabase]);

  // Realtime: qualquer mudanca feita pelo outro celular recarrega o estado.
  useEffect(() => {
    if (!household) return;

    const channel = supabase
      .channel(`casa:${household.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "list_items",
          filter: `household_id=eq.${household.id}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `household_id=eq.${household.id}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "purchases",
          filter: `household_id=eq.${household.id}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [household, load, supabase]);

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
      supabase,
      refresh: load,
    }),
    [loading, error, user, household, products, pending, suggestions, supabase, load],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
