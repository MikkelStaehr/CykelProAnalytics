"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Minimal stroke icons (Heroicons outline style, 24×24 viewBox)
function Icon({ path }: { path: string }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      className="shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

const NAV_ITEMS = [
  {
    href: "/",
    label: "Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    href: "/race-preview",
    label: "Race Preview",
    icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  {
    href: "/analyse",
    label: "Analyse",
    icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  },
  {
    href: "/profil",
    label: "Profil",
    icon: "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
  },
  {
    href: "/stage-race",
    label: "Stage Race",
    icon: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    href: "/admin",
    label: "Admin",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
] as const;

export default function Nav() {
  const pathname = usePathname();

  return (
    <aside
      className="w-52 shrink-0 flex flex-col sticky top-0 h-screen"
      style={{ backgroundColor: "var(--c-surface)", borderRight: "1px solid var(--c-border)" }}
    >
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--c-border)" }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: "var(--c-muted)" }}>
          CykelPro
        </p>
        <p className="text-sm font-semibold mt-1" style={{ color: "var(--c-text)" }}>
          Analytics 2026
        </p>
      </div>

      {/* Links */}
      <nav className="flex flex-col gap-0.5 p-3 flex-1">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              style={
                active
                  ? {
                      backgroundColor: "rgba(59,130,246,0.12)",
                      color: "var(--c-blue)",
                      border: "1px solid rgba(59,130,246,0.25)",
                    }
                  : {
                      color: "var(--c-muted)",
                      border: "1px solid transparent",
                    }
              }
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all hover:text-(--c-text) hover:bg-white/5"
            >
              <Icon path={icon} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: "1px solid var(--c-border)" }}>
        <p className="text-[11px]" style={{ color: "var(--c-muted)" }}>Sæson 2026 · 13 løb</p>
      </div>
    </aside>
  );
}
