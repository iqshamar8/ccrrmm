"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import SendMessage from "@/components/messaging/SendMessage";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { SOURCES } from "@/lib/labels2";

type Kind = "inactive" | "programs" | "subscriptions" | "leads" | "birthdays";
type Row = { id: string; code: string; fullName: string; phone: string; lastVisitAt: string | null; createdAt: string; source: string | null; marketingOptOut: boolean; detail: unknown; lastContactAt: string | null; endDate?: string; lastSessionAt?: string | null; status?: string };
const KINDS: { key: Kind; ar: string; en: string; days?: number; cat: string; hint: [string, string] }[] = [
  { key: "inactive", ar: "عملاء غير نشطين", en: "Inactive clients", days: 45, cat: "REACTIVATION", hint: ["بدون زيارة ولا موعد قادم", "No visit and nothing booked"] },
  { key: "programs", ar: "برامج لم تكتمل", en: "Unfinished programs", cat: "SESSION_REMINDER", hint: ["جلسات متبقية بدون حجز", "Sessions left, none booked"] },
  { key: "subscriptions", ar: "اشتراكات تنتهي قريباً", en: "Expiring subscriptions", days: 14, cat: "SUBSCRIPTION_EXPIRY", hint: ["فرصة للتجديد", "Renewal opportunity"] },
  { key: "leads", ar: "عملاء محتملون لم يتحولوا", en: "Unconverted leads", days: 3, cat: "CUSTOM", hint: ["أقدم من عدد الأيام", "Older than N days"] },
  { key: "birthdays", ar: "أعياد ميلاد هذا الأسبوع", en: "Birthdays this week", cat: "CUSTOM", hint: ["تهنئة وهدية", "Greeting & gift"] },
];

export default function FollowUpsPage() {
  const { tr, can, locale } = useSession();
  const [kind, setKind] = useState<Kind>("inactive");
  const def = KINDS.find((k) => k.key === kind)!;
  const [days, setDays] = useState<Record<string, string>>({});
  const d = days[kind] ?? String(def.days ?? "");
  const { data, loading, reload } = useResource<Row[]>(can("clients.view") ? `/api/marketing/follow-ups?kind=${kind}${def.days ? `&days=${d || def.days}` : ""}` : null);
  const [sel, setSel] = useState<string[]>([]);
  const [send, setSend] = useState(false);
  const [log, setLog] = useState<Row | null>(null);
  if (!can("clients.view")) return <Forbidden />;
  const rows = data ?? [];
  const all = rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const detail = (r: Row) => {
    if (kind === "inactive") return r.detail === null ? tr("لم يزر بعد", "Never visited") : tr(`${r.detail} يوم منذ آخر زيارة`, `${r.detail} days since last visit`);
    if (kind === "programs") return `${String(r.detail).split(" · ")[0]} — ${tr("متبقٍ", "left")} ${String(r.detail).split(" · ")[1]}`;
    if (kind === "subscriptions") return `${r.detail} — ${tr("ينتهي", "ends")} ${fmtDate(r.endDate!, locale)}`;
    if (kind === "leads") return tr(`محتمل منذ ${r.detail} يوم`, `Lead for ${r.detail} days`);
    return fmtDate(String(r.detail), locale);
  };
  return (
    <>
      <PageHeader title={tr("قوائم المتابعة", "Follow-up lists")} subtitle={tr("من يجب التواصل معه اليوم: غير النشطين، البرامج غير المكتملة، الاشتراكات المنتهية، العملاء المحتملون وأعياد الميلاد.", "Who to contact today: inactive clients, unfinished programs, expiring subscriptions, leads and birthdays.")} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {KINDS.map((k) => <button key={k.key} onClick={() => { setKind(k.key); setSel([]); }} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${kind === k.key ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{tr(k.ar, k.en)}</button>)}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <span className="text-sm text-muted">{tr(...def.hint)}</span>
          {def.days !== undefined && <label className="flex items-center gap-1 text-sm">{tr("الأيام", "Days")}<Input type="number" min={1} dir="ltr" className="w-20" value={d} onChange={(e) => setDays({ ...days, [kind]: e.target.value })} /></label>}
          <span className="flex-1" />
          {can("notifications.create") && sel.length > 0 && <Button onClick={() => setSend(true)}>{tr("مراسلة واتساب", "WhatsApp")} ({sel.length})</Button>}
        </div>
        <Table head={[<input key="a" type="checkbox" checked={all} onChange={() => setSel(all ? [] : rows.map((r) => r.id))} aria-label="all" />, tr("العميل", "Client"), tr("التفاصيل", "Details"), tr("المصدر", "Source"), tr("آخر تواصل", "Last contact"), ""]}>
          {loading && !data ? <LoadingRows cols={6} /> : rows.map((r) => (
            <Tr key={r.id + (r.endDate ?? "")}>
              <Td><input type="checkbox" checked={sel.includes(r.id)} onChange={() => setSel((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} /></Td>
              <Td><Link className="font-medium text-brand hover:underline" href={`/clients/${r.id}`}>{r.fullName}</Link><div className="text-xs text-muted" dir="ltr">{r.phone}</div>{r.marketingOptOut && <Badge tone="amber">{tr("أوقف الرسائل التسويقية", "Opted out")}</Badge>}</Td>
              <Td className="text-sm">{detail(r)}</Td>
              <Td className="text-xs text-muted">{r.source ? (locale === "en" ? SOURCES[r.source]?.en : SOURCES[r.source]?.ar) ?? r.source : "—"}</Td>
              <Td className="text-xs text-muted">{r.lastContactAt ? fmtDate(r.lastContactAt, locale, true) : tr("لم يتم", "None")}</Td>
              <Td>{can("clients.update") && <Button size="sm" variant="ghost" onClick={() => setLog(r)}>{tr("تسجيل اتصال", "Log call")}</Button>}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !rows.length && <EmptyState title={tr("لا يوجد أحد في هذه القائمة", "Nobody on this list")} text={tr("ممتاز!", "Nice work!")} />}
      </Card>
      <SendMessage open={send} clientIds={sel} defaultCategory={def.cat} onClose={() => setSend(false)} onSent={() => { setSel([]); reload(); }} />
      <LogCall r={log} onClose={() => setLog(null)} onDone={() => { setLog(null); reload(); }} />
    </>
  );
}

function LogCall({ r, onClose, onDone }: { r: Row | null; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const [type, setType] = useState("CALL");
  const [content, setContent] = useState("");
  const { pending, run } = useSubmit();
  return (
    <Modal open={!!r} onClose={onClose} title={`${tr("تسجيل تواصل مع", "Log contact with")} ${r?.fullName ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} disabled={content.trim().length < 2} onClick={async () => { if (await run(() => api(`/api/clients/${r!.id}/interactions`, { method: "POST", body: { type, content } }), tr("تم التسجيل", "Logged"))) { setContent(""); onDone(); } }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="space-y-3">
        <Field label={tr("الوسيلة", "Channel")}><Select value={type} onChange={(e) => setType(e.target.value)}><option value="CALL">{tr("اتصال", "Call")}</option><option value="WHATSAPP">WhatsApp</option><option value="NOTE">{tr("ملاحظة", "Note")}</option></Select></Field>
        <Field label={tr("النتيجة", "Outcome")}><textarea rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={content} onChange={(e) => setContent(e.target.value)} placeholder={tr("مثال: سيحجز الأسبوع القادم", "e.g. will book next week")} /></Field>
      </div>
    </Modal>
  );
}
