"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal, PageHeader, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";

type Tier = { id: string; name: string; nameEn: string | null; minPoints: number; multiplier: string; color: string | null };
type Overview = { totals: { outstanding: number; issued: number }; clients: { id: string; code: string; fullName: string; phone: string; balance: number; lifetime: number; tier: Tier | null }[] };
type Settings = { loyaltyEnabled: boolean; pointsPerUnit: string; pointValue: string; minRedeemPoints: number };

export default function LoyaltyPage() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const ok = can("loyalty.view");
  const ov = useResource<Overview>(ok ? "/api/loyalty" : null);
  const tiers = useResource<Tier[]>(ok ? "/api/loyalty/tiers" : null);
  const settings = useResource<Settings>(ok ? "/api/settings/billing" : null);
  const [tierEdit, setTierEdit] = useState<Tier | "new" | null>(null);
  const [adjust, setAdjust] = useState<{ id: string; fullName: string } | null>(null);
  const [q, setQ] = useState("");
  if (!ok) return <Forbidden />;
  const s = settings.data;
  const rows = (ov.data?.clients ?? []).filter((c) => !q || c.fullName.includes(q) || c.phone.includes(q));

  return (
    <>
      <PageHeader title={tr("نقاط الولاء والمكافآت", "Loyalty & rewards")} subtitle={tr("كسب النقاط عند الدفع، استبدالها بخصومات، ومستويات العملاء", "Earn on payment, redeem as discounts, client tiers")} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={tr("النقاط القائمة", "Outstanding points")} value={ov.data?.totals.outstanding.toLocaleString() ?? "…"} hint={s ? money((ov.data?.totals.outstanding ?? 0) * Number(s.pointValue)) : undefined} />
        <StatCard label={tr("النقاط الممنوحة (كلياً)", "Points issued")} value={ov.data?.totals.issued.toLocaleString() ?? "…"} />
        <StatCard label={tr("قاعدة الكسب", "Earning rule")} value={<span className="text-base">{s ? `${Number(s.pointsPerUnit)} ${tr("نقطة / وحدة عملة", "pt per currency unit")}` : "…"}</span>} hint={s && !s.loyaltyEnabled ? tr("البرنامج متوقف", "Program disabled") : undefined} />
        <StatCard label={tr("قيمة النقطة", "Point value")} value={<span className="text-base">{s ? money(s.pointValue) : "…"}</span>} hint={s ? `${tr("حد أدنى للاستبدال", "min redeem")} ${s.minRedeemPoints}` : undefined} />
      </div>
      {can("settings.update") && s && <SettingsCard s={s} onSaved={settings.reload} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="h-fit">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="font-medium">{tr("مستويات العملاء", "Tiers")}</p>{can("loyalty.create") && <Button size="sm" variant="secondary" onClick={() => setTierEdit("new")}>+</Button>}</div>
          <ul className="divide-y divide-line">
            {tiers.data?.map((t) => (
              <li key={t.id}><button className="flex w-full items-center justify-between px-4 py-3 text-start hover:bg-surface-2" onClick={() => can("loyalty.update") && setTierEdit(t)}>
                <span className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: t.color ?? "var(--series-1)" }} />{locale === "ar" ? t.name : t.nameEn ?? t.name}</span>
                <span className="text-xs text-muted tabular">≥ {t.minPoints} · ×{Number(t.multiplier)}</span>
              </button></li>
            ))}
            {tiers.data?.length === 0 && <li className="p-4 text-sm text-muted">{tr("لا توجد مستويات", "No tiers")}</li>}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <div className="border-b border-line p-3"><Input className="max-w-xs" placeholder={tr("بحث عن عميل…", "Search client…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Table head={[tr("العميل", "Client"), tr("المستوى", "Tier"), tr("الرصيد", "Balance"), tr("المكتسب كلياً", "Lifetime"), tr("القيمة", "Value"), ""]}>
            {rows.map((c) => (
              <Tr key={c.id}>
                <Td><p className="font-medium">{c.fullName}</p><p className="text-xs text-muted" dir="ltr">{c.code}</p></Td>
                <Td>{c.tier ? <Badge><span className="me-1 inline-block size-2 rounded-full" style={{ background: c.tier.color ?? "var(--series-1)" }} />{locale === "ar" ? c.tier.name : c.tier.nameEn ?? c.tier.name}</Badge> : "—"}</Td>
                <Td className="font-medium tabular">{c.balance.toLocaleString()}</Td><Td className="tabular text-muted">{c.lifetime.toLocaleString()}</Td>
                <Td className="tabular">{s ? money(c.balance * Number(s.pointValue)) : ""}</Td>
                <Td className="text-end">{can("loyalty.update") && <Button size="sm" variant="ghost" onClick={() => setAdjust(c)}>{tr("تعديل الرصيد", "Adjust")}</Button>}</Td>
              </Tr>
            ))}
          </Table>
          {rows.length === 0 && <EmptyState title={tr("لا توجد أرصدة نقاط بعد", "No point balances yet")} />}
        </Card>
      </div>
      <TierModal tier={tierEdit} onClose={() => setTierEdit(null)} onSaved={() => { setTierEdit(null); tiers.reload(); ov.reload(); }} />
      <AdjustModal client={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); ov.reload(); }} />
    </>
  );
}

function SettingsCard({ s, onSaved }: { s: Settings; onSaved: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ loyaltyEnabled: s.loyaltyEnabled, pointsPerUnit: String(Number(s.pointsPerUnit)), pointValue: String(Number(s.pointValue)), minRedeemPoints: String(s.minRedeemPoints) });
  const { pending, run } = useSubmit();
  return (
    <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
      <Checkbox label={tr("تفعيل برنامج الولاء", "Enable loyalty")} checked={f.loyaltyEnabled} onChange={(e) => setF({ ...f, loyaltyEnabled: e.target.checked })} />
      <Field label={tr("نقاط لكل وحدة عملة مدفوعة", "Points per currency unit")}><Input className="w-40" type="number" min={0} step="any" dir="ltr" value={f.pointsPerUnit} onChange={(e) => setF({ ...f, pointsPerUnit: e.target.value })} /></Field>
      <Field label={tr("قيمة النقطة عند الاستبدال", "Value per point")}><Input className="w-40" type="number" min={0} step="any" dir="ltr" value={f.pointValue} onChange={(e) => setF({ ...f, pointValue: e.target.value })} /></Field>
      <Field label={tr("حد أدنى للاستبدال", "Min to redeem")}><Input className="w-32" type="number" min={0} dir="ltr" value={f.minRedeemPoints} onChange={(e) => setF({ ...f, minRedeemPoints: e.target.value })} /></Field>
      <Button loading={pending} onClick={async () => { if (await run(() => api("/api/settings/billing", { method: "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>{tr("حفظ", "Save")}</Button>
      <p className="w-full text-xs text-muted">{tr("تُمنح النقاط عند سداد الفاتورة بالكامل وتُضرب بمعامل مستوى العميل، وتُعكس تلقائياً عند الاسترجاع أو الإلغاء.", "Points are earned when an invoice is fully paid (× tier multiplier) and reversed automatically on refund/cancel.")}</p>
    </Card>
  );
}

function TierModal({ tier, onClose, onSaved }: { tier: Tier | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr, can } = useSession();
  const isNew = tier === "new";
  const [f, setF] = useState({ name: "", nameEn: "", minPoints: "0", multiplier: "1", color: "#0f766e" });
  const { pending, run } = useSubmit();
  useEffect(() => { if (tier === "new") setF({ name: "", nameEn: "", minPoints: "0", multiplier: "1", color: "#0f766e" }); else if (tier) setF({ name: tier.name, nameEn: tier.nameEn ?? "", minPoints: String(tier.minPoints), multiplier: String(Number(tier.multiplier)), color: tier.color ?? "#0f766e" }); }, [tier]);
  return (
    <Modal open={!!tier} onClose={onClose} title={isNew ? tr("مستوى جديد", "New tier") : tr("تعديل المستوى", "Edit tier")}
      footer={<div className="flex w-full justify-between">
        <div>{!isNew && can("loyalty.delete") && <Button variant="ghost" className="text-danger" loading={pending} onClick={async () => { if (await run(() => api(`/api/loyalty/tiers/${(tier as Tier).id}`, { method: "DELETE" }), tr("تم الحذف", "Deleted"))) onSaved(); }}>{tr("حذف", "Delete")}</Button>}</div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} onClick={async () => { if (await run(() => api(isNew ? "/api/loyalty/tiers" : `/api/loyalty/tiers/${(tier as Tier).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>{tr("حفظ", "Save")}</Button></div>
      </div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("الاسم", "Name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("الاسم بالإنجليزية", "English name")}><Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
        <Field label={tr("الحد الأدنى من النقاط المكتسبة", "Min lifetime points")}><Input type="number" min={0} dir="ltr" value={f.minPoints} onChange={(e) => setF({ ...f, minPoints: e.target.value })} /></Field>
        <Field label={tr("معامل الكسب", "Earning multiplier")}><Input type="number" min={0.1} step="0.05" dir="ltr" value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} /></Field>
        <Field label={tr("اللون", "Colour")}><input type="color" className="h-10 w-full rounded-lg border border-line" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ client, onClose, onSaved }: { client: { id: string; fullName: string } | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [f, setF] = useState({ points: "", note: "" });
  const { pending, run } = useSubmit();
  useEffect(() => setF({ points: "", note: "" }), [client]);
  return (
    <Modal open={!!client} onClose={onClose} title={`${tr("تعديل رصيد", "Adjust points")} — ${client?.fullName ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} disabled={!Number(f.points) || f.note.trim().length < 2}
        onClick={async () => { if (await run(() => api(`/api/clients/${client!.id}/loyalty`, { body: f }), tr("تم تعديل الرصيد", "Points adjusted"))) onSaved(); }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="grid gap-3">
        <Field label={tr("النقاط (+ إضافة / − خصم)", "Points (+ add / − remove)")}><Input type="number" dir="ltr" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></Field>
        <Field label={tr("السبب", "Reason")}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={tr("مكافأة عيد ميلاد، تعويض…", "Birthday gift, compensation…")} /></Field>
      </div>
    </Modal>
  );
}
