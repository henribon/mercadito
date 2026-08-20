"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { IconBox, IconHistory, IconList, IconScan } from "./Icons";

const TABS = [
  { href: "/", label: "Lista", Icon: IconList },
  { href: "/escanear", label: "Escanear", Icon: IconScan },
  { href: "/historico", label: "Histórico", Icon: IconHistory },
  { href: "/produtos", label: "Produtos", Icon: IconBox },
] as const;

/**
 * Barra inferior no celular (alcance do polegar durante a compra) e barra
 * superior no desktop. Mesmo DOM, so muda o posicionamento.
 */
export function TabBar() {
  const pathname = usePathname();

  if (pathname.startsWith("/login") || pathname.startsWith("/auth")) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur
                 pb-safe md:inset-x-auto md:bottom-auto md:top-0 md:left-0 md:right-0
                 md:border-t-0 md:border-b"
    >
      <div className="mx-auto flex max-w-xl md:h-14 md:items-center md:justify-center md:gap-1">
        {TABS.map(({ href, label, Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium
                          transition-colors md:flex-none md:flex-row md:gap-2 md:rounded-lg
                          md:px-3.5 md:py-2 md:text-sm
                          ${
                            active
                              ? "text-accent md:bg-accent-soft"
                              : "text-muted hover:text-text md:hover:bg-surface-2"
                          }`}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
