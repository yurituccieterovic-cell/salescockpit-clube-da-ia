import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, Mail, LogOut, FlameKindling, TreePine, Scale, Gavel, Newspaper, Mic2, ShieldCheck, Wallet, Compass, Trees, FileCode, Code2, Sprout, FlaskConical, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  highlight?: "orange" | "amber" | "rose" | "emerald" | "violet" | "zinc";
  badge?: string;
  indent?: boolean;
}

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/app", icon: LayoutDashboard },
  { title: "Leads", href: "/leads", icon: Users },
  { title: "Emails", href: "/emails", icon: Mail },
  { title: "Clube IA", href: "/clube", icon: FlameKindling, highlight: "orange" },
  { title: "Árvore Oracular", href: "/oraculo", icon: TreePine, highlight: "amber" },
  { title: "Workspace da Árvore", href: "/arvore-workspace", icon: FileCode, highlight: "amber", indent: true },
  { title: "Árvore programadora", href: "/arvore-code", icon: Code2, highlight: "amber", indent: true },
  { title: "Mapa epistemológico", href: "/mapa", icon: Compass, highlight: "amber", indent: true },
  { title: "Ecossistema", href: "/eco", icon: Sprout },
  { title: "Playground", href: "/playground", icon: FlaskConical },
  { title: "Assembleias", href: "/assembleia", icon: Scale, highlight: "rose" },
  { title: "Assembleias · Histórico", href: "/assembleia/historico", icon: Scale, highlight: "rose", indent: true },
  { title: "Ágora · Histórico", href: "/agora/historico", icon: Gavel, highlight: "rose", indent: true },
  { title: "Jornal", href: "/jornal", icon: Newspaper, highlight: "violet" },
  { title: "Vozes", href: "/vozes", icon: Mic2, highlight: "emerald" },
  { title: "Ética do Sistema", href: "/etica", icon: ShieldCheck, highlight: "zinc" },
  { title: "EPR²T · Raízes do Bosque", href: "/epret", icon: Trees, highlight: "emerald", indent: true },
  { title: "PAP · Aliança Panorama", href: "/pap", icon: Compass, highlight: "violet", indent: true },
  { title: "Custos & Uso", href: "/custos", icon: Wallet, highlight: "emerald" },
];

const STORAGE_KEY = "salescockpit:sidebar-collapsed";

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  // collapsed = comportamento desktop (md+): só recolhe pra w-14
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });
  // mobileOpen = drawer off-canvas no mobile (<md)
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  // Fecha drawer mobile ao navegar
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  // No mobile, força expandido (w-64) — não faz sentido recolher pra w-14 num drawer
  const isCompact = collapsed;

  return (
    <>
      {/* Hamburger fixo no canto superior esquerdo — só mobile */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-40 rounded-md bg-sidebar text-sidebar-foreground border shadow-md p-2 hover:bg-sidebar-accent/50 transition-colors"
        title="Abrir menu"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity"
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          // Base
          "flex h-screen flex-col border-r bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-out",
          // Mobile: drawer fixo off-canvas, sempre largo
          "fixed inset-y-0 left-0 z-50 w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop (md+): volta a ser estático, respeita collapsed
          "md:static md:translate-x-0",
          isCompact ? "md:w-14" : "md:w-64",
        )}
      >
        <div className={cn(
          "flex h-14 items-center border-b",
          // Mobile sempre tem padding/gap; desktop respeita collapsed
          "px-4 gap-2",
          isCompact ? "md:justify-center md:px-1 md:gap-0" : "md:px-4 md:gap-2",
        )}>
          <Link href="/app" className="flex items-center gap-2 font-semibold min-w-0" title="SalesCockpit">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="text-xl leading-none font-bold">⚡</span>
            </div>
            <span className={cn("truncate", isCompact ? "md:hidden" : "")}>SalesCockpit</span>
          </Link>
          {/* Fechar drawer (mobile) */}
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden ml-auto rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            title="Fechar menu"
            aria-label="Fechar menu"
          >
            <X className="h-4 w-4" />
          </button>
          {/* Recolher (desktop, quando expandido) */}
          {!isCompact && (
            <button
              onClick={() => setCollapsed(true)}
              className="hidden md:block ml-auto rounded-md p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
              title="Recolher menu"
              aria-label="Recolher menu"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Expandir (desktop, quando recolhido) */}
        {isCompact && (
          <button
            onClick={() => setCollapsed(false)}
            className="hidden md:block mx-auto mt-2 rounded-md p-1.5 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            title="Expandir menu"
            aria-label="Expandir menu"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1 overflow-auto py-4">
          <nav className={cn("space-y-0.5 px-2", isCompact ? "md:px-1" : "md:px-2")}>
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/app" && !item.indent && location.startsWith(item.href));
              const isActiveExact = item.indent ? location === item.href : isActive;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={isCompact ? item.title : undefined}
                  className={cn(
                    "flex items-center rounded-md text-sm font-medium transition-colors",
                    // Mobile: sempre layout expandido
                    "gap-3 px-3 py-2",
                    isCompact ? "md:justify-center md:px-2 md:py-2 md:gap-0" : "md:gap-3 md:px-3 md:py-2",
                    item.indent ? (isCompact ? "md:pl-2" : "pl-7 text-[13px]") : "",
                    isActiveExact
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : item.highlight === "orange"
                      ? "text-orange-500 hover:bg-orange-500/10 hover:text-orange-600"
                      : item.highlight === "amber"
                      ? "text-amber-600 hover:bg-amber-500/10 hover:text-amber-700"
                      : item.highlight === "rose"
                      ? "text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
                      : item.highlight === "violet"
                      ? "text-violet-600 hover:bg-violet-500/10 hover:text-violet-700"
                      : item.highlight === "emerald"
                      ? "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
                      : item.highlight === "zinc"
                      ? "text-zinc-700 hover:bg-zinc-500/10 hover:text-zinc-900"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className={cn("shrink-0 h-4 w-4", item.indent && !isCompact ? "md:h-3.5 md:w-3.5" : "")} />
                  <span className={cn("truncate", isCompact ? "md:hidden" : "")}>{item.title}</span>
                  {item.highlight === "orange" && (
                    <span className={cn("ml-auto rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-500 uppercase tracking-wide", isCompact ? "md:hidden" : "")}>NEW</span>
                  )}
                  {item.highlight === "amber" && (
                    <span className={cn("ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 uppercase tracking-wide", isCompact ? "md:hidden" : "")}>IA</span>
                  )}
                  {item.highlight === "violet" && (
                    <span className={cn("ml-auto rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-600 uppercase tracking-wide", isCompact ? "md:hidden" : "")}>NEW</span>
                  )}
                  {item.highlight === "emerald" && (
                    <span className={cn("ml-auto rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 uppercase tracking-wide", isCompact ? "md:hidden" : "")}>14</span>
                  )}
                  {item.highlight === "zinc" && (
                    <span className={cn("ml-auto rounded-full bg-zinc-500/20 px-1.5 py-0.5 text-[10px] font-bold text-zinc-700 uppercase tracking-wide", isCompact ? "md:hidden" : "")}>NEW</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className={cn("border-t space-y-3 p-4", isCompact ? "md:p-2" : "md:p-4")}>
          <div className={cn("flex items-center gap-3", isCompact ? "md:justify-center md:gap-0" : "md:gap-3")} title={isCompact ? (user ?? "Usuário") : undefined}>
            <div
              className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #06b6d4, #ec4899)" }}
            >
              {(user ?? "AO").slice(0, 2).toUpperCase()}
            </div>
            <div className={cn("flex flex-col min-w-0", isCompact ? "md:hidden" : "")}>
              <span className="text-sm font-medium truncate">{user ?? "Usuário"}</span>
              <span className="text-xs text-muted-foreground">Power User</span>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            title={isCompact ? "Sair" : undefined}
            className={cn(
              "flex w-full items-center rounded-md text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors gap-2 px-3 py-2",
              isCompact ? "md:justify-center md:px-2 md:gap-0" : "md:gap-2 md:px-3",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={cn(isCompact ? "md:hidden" : "")}>Sair</span>
          </button>
        </div>
      </div>
    </>
  );
}
