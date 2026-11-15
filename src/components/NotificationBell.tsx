"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/providers";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

/** Staff in-app notifications: unread badge, dropdown, mark as read. Polls every 60s while the tab is visible. */
export default function NotificationBell() {
  const { tr, locale, tenant } = useSession();
  const [data, setData] = useState<{ items: N[]; unread: number } | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => { try { setData(await api("/api/me/notifications?limit=15")); } catch { /* offline / signed out */ } }, []);
  useEffect(() => {
    if (!tenant) return;
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000);
    return () => clearInterval(t);
  }, [load, tenant]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!tenant) return null;
  const read = async (ids?: string[]) => { await api("/api/me/notifications/read", { method: "POST", body: ids ? { ids } : { all: true } }).catch(() => null); load(); };
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button onClick={() => { setOpen(!open); if (!open) load(); }} className="relative rounded-lg p-2 hover:bg-surface-2" aria-label={tr("الإشعارات", "Notifications")}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unread > 0 && <span className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute end-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium">{tr("الإشعارات", "Notifications")}</span>
            {unread > 0 && <button className="text-xs text-brand hover:underline" onClick={() => read()}>{tr("تحديد الكل كمقروء", "Mark all read")}</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).map((n) => {
              const inner = <>
                <p className={`text-sm ${n.readAt ? "text-muted" : "font-medium"}`}>{!n.readAt && <span className="me-1.5 inline-block size-2 rounded-full bg-brand align-middle" />}{n.title}</p>
                {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>}
                <p className="mt-1 text-[11px] text-muted">{fmtDate(n.createdAt, locale, true)}</p>
              </>;
              return (
                <li key={n.id} className="border-b border-line last:border-0">
                  {n.link
                    ? <Link href={n.link} className="block px-3 py-2 hover:bg-surface-2" onClick={() => { setOpen(false); if (!n.readAt) read([n.id]); }}>{inner}</Link>
                    : <button className="block w-full px-3 py-2 text-start hover:bg-surface-2" onClick={() => !n.readAt && read([n.id])}>{inner}</button>}
                </li>
              );
            })}
            {data && !data.items.length && <li className="px-3 py-8 text-center text-sm text-muted">{tr("لا توجد إشعارات", "No notifications")}</li>}
          </ul>
          <Link href="/inbox" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-sm text-brand hover:bg-surface-2">{tr("عرض كل الإشعارات", "View all")}</Link>
        </div>
      )}
    </div>
  );
}
