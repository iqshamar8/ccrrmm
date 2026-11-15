"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/components/providers";
import { Input } from "@/components/ui";
import { api } from "@/lib/client";

export type PickedClient = { id: string; fullName: string; code?: string; phone?: string; branchId?: string };

/** Search-as-you-type client selector used by program/subscription/surgery/review forms. */
export default function ClientPicker({ value, onChange, locked }: { value: PickedClient | null; onChange: (c: PickedClient | null) => void; locked?: boolean }) {
  const { tr } = useSession();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickedClient[]>([]);
  useEffect(() => {
    if (value || q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api<PickedClient[]>(`/api/clients/lookup?q=${encodeURIComponent(q)}`).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q, value]);
  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">
        <span className="font-medium">{value.fullName} {value.code && <span className="text-xs text-muted">{value.code}</span>}</span>
        {!locked && <button type="button" className="text-xs text-brand" onClick={() => { onChange(null); setQ(""); }}>{tr("تغيير", "Change")}</button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <Input autoFocus placeholder={tr("ابحث عن العميل بالاسم أو الهاتف…", "Search client by name or phone…")} value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
          {hits.map((h) => (
            <button type="button" key={h.id} onClick={() => onChange(h)} className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-2">
              <span>{h.fullName} <span className="text-xs text-muted">{h.code}</span></span><span className="text-xs text-muted" dir="ltr">{h.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
