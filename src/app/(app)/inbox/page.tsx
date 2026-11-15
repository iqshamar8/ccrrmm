"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, EmptyState, LoadingRows, PageHeader } from "@/components/ui";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type N = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export default function InboxPage() {
  const { tr, locale } = useSession();
  const [unread, setUnread] = useState(false);
  const { data, loading, reload } = useResource<{ items: N[]; unread: number }>(`/api/me/notifications?limit=200${unread ? "&unread=1" : ""}`);
  const read = async (ids?: string[]) => { await api("/api/me/notifications/read", { method: "POST", body: ids ? { ids } : { all: true } }); reload(); };
  return (
    <>
      <PageHeader title={tr("إشعاراتي", "My notifications")} subtitle={tr("تنبيهات المواعيد الجديدة، الإجازات، المخزون، المراجعات المتأخرة وغيرها.", "New appointments, leave requests, stock, overdue reviews and more.")}
        actions={!!data?.unread && <Button variant="secondary" onClick={() => read()}>{tr("تحديد الكل كمقروء", "Mark all read")}</Button>} />
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />{tr("غير المقروءة فقط", "Unread only")} ({data?.unread ?? 0})</label>
      <Card>
        {loading && !data ? <div className="p-4"><LoadingRows cols={2} /></div> : (
          <ul>{(data?.items ?? []).map((n) => (
            <li key={n.id} className={`flex items-start gap-3 border-b border-line px-4 py-3 last:border-0 ${n.readAt ? "" : "bg-brand/5"}`}>
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand"}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${n.readAt ? "" : "font-medium"}`}>{n.link ? <Link className="hover:underline" href={n.link} onClick={() => !n.readAt && read([n.id])}>{n.title}</Link> : n.title}</p>
                {n.body && <p className="text-sm text-muted">{n.body}</p>}
                <p className="mt-1 text-xs text-muted">{fmtDate(n.createdAt, locale, true)}</p>
              </div>
              {!n.readAt && <Button size="sm" variant="ghost" onClick={() => read([n.id])}>{tr("مقروء", "Read")}</Button>}
            </li>
          ))}</ul>
        )}
        {!loading && !data?.items.length && <EmptyState title={tr("لا توجد إشعارات", "No notifications")} />}
      </Card>
    </>
  );
}
