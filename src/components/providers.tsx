"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { type Locale, makeTr } from "@/lib/i18n";

export type SessionInfo = {
  locale: Locale;
  user: { id: string; email: string; fullName: string; isPlatformAdmin: boolean; roleName: string | null; roleKey: string | null };
  tenant: null | {
    id: string; name: string; slug: string; type: string; primaryColor: string; accentColor: string; logoUrl: string | null; baseCurrency: string;
    access: string; plan: null | { nameAr: string; nameEn: string; maxUsers: number; maxBranches: number };
    subscription: null | { status: string; endsAt: string | null; trialEndsAt: string | null };
  };
  permissions: string[];
  features: string[];
};

type SessionCtx = SessionInfo & { tr: (ar: string, en: string) => string; can: (p: string) => boolean };
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ value, children }: { value: SessionInfo; children: React.ReactNode }) {
  const v = useMemo(() => {
    const set = new Set(value.permissions);
    return { ...value, tr: makeTr(value.locale), can: (p: string) => set.has(p) };
  }, [value]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}

// ---------------------------------------------------------------- toasts ----
type Toast = { id: number; kind: "success" | "error"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
        {items.map((t) => (
          <div key={t.id}
            className={`toast-in pointer-events-auto max-w-md w-full rounded-lg px-4 py-3 text-sm shadow-lg text-white ${t.kind === "success" ? "bg-emerald-600" : "bg-red-600"}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
