import { headers } from "next/headers";

import { auth } from "./auth";
import { queryOne } from "./db";
import { HOUSEHOLD_FOR_USER } from "./sql";
import type { Household } from "./types";

/**
 * Fronteira de seguranca do app.
 *
 * No Supabase o isolamento entre casas era feito por RLS dentro do banco. Aqui
 * o acesso ao Postgres e exclusivamente server-side, entao o escopo e aplicado
 * aqui: toda Server Action comeca por `requireMembership()` e usa o
 * `household.id` devolvido para filtrar as consultas — nunca um id vindo do
 * cliente.
 */

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new Error("Não autenticado.");
  return user;
}

export type Membership = { user: SessionUser; household: Household };

/** Usuario logado + a casa de que ele e membro. Null se ainda nao entrou em uma. */
export async function getMembership(): Promise<Membership | null> {
  const user = await currentUser();
  if (!user) return null;

  const household = await queryOne<Household>(HOUSEHOLD_FOR_USER, [user.id]);

  return household ? { user, household } : null;
}

/** Igual ao anterior, mas explode se nao houver casa — use nas mutacoes. */
export async function requireMembership(): Promise<Membership> {
  const membership = await getMembership();
  if (!membership) throw new Error("Você ainda não faz parte de uma casa.");
  return membership;
}
