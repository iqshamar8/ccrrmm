"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { AccountingTabs, AccountOptions, SOURCES, useLeafAccounts } from "@/components/accounting/shared";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Entry = { id: string; code: string; date: string; description: string; source: string; reversalOfId: string | null; lines: { id: string; debit: string; credit: string; description: string | null; account: { code: string; name: string } }[] };

export default function JournalsPage() {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const [f, setF] = useState({ source: "", from: "", to: "", q: "" });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...f, page: String(page) }).toString();
  const { data, loading, reload } = useResource<{ items: Entry[]; total: number; page: number }>(can("accounting.view") ? `/api/accounting/journals?${qs}` : null);
  const [open, setOpen] = useState<Entry | null>(null);
  const [create, setCreate] = useState(false);
  if (!can("accounting.view")) return <Forbidden />;
  const pages = Math.ceil((data?.total ?? 0) / 50);
  return (
    <>
      <PageHeader title={tr("المحاسبة", "Accounting")} subtitle={tr("دفتر اليومية: كل القيود التلقائية واليدوية. يكون القيد متوازناً دائماً (تتحقق منه قاعدة البيانات).", "The journal: every automatic and manual entry. Always balanced — enforced by the database.")}
        actions={can("accounting.create") && <Button onClick={() => setCreate(true)}>+ {tr("قيد يدوي", "Manual entry")}</Button>} />
      <AccountingTabs active="journals" />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالرقم أو البيان…", "Search code or description…")} value={f.q} onChange={(e) => { setPage(1); setF({ ...f, q: e.target.value }); }} />
          <Select className="max-w-[12rem]" value={f.source} onChange={(e) => { setPage(1); setF({ ...f, source: e.target.value }); }}>
            <option value="">{tr("كل المصادر", "All sources")}</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}
          </Select>
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={f.from} onChange={(e) => { setPage(1); setF({ ...f, from: e.target.value }); }} />
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={f.to} onChange={(e) => { setPage(1); setF({ ...f, to: e.target.value }); }} />
        </div>
        <Table head={[tr("الرقم", "No."), tr("التاريخ", "Date"), tr("المصدر", "Source"), tr("البيان", "Description"), tr("المبلغ", "Amount")]}>
          {loading && !data ? <LoadingRows cols={5} /> : (data?.items ?? []).map((e) => (
            <Tr key={e.id} onClick={() => setOpen(e)}>
              <Td><span dir="ltr" className="font-mono text-xs">{e.code}</span></Td><Td className="text-muted">{fmtDate(e.date, locale)}</Td>
              <Td><Badge tone={e.reversalOfId ? "amber" : "gray"}>{tr(...(SOURCES[e.source] ?? [e.source, e.source]))}</Badge></Td>
              <Td className="text-sm">{e.description}</Td>
              <Td className="tabular">{money(e.lines.reduce((s, l) => s + Number(l.debit), 0))}</Td>
            </Tr>
          ))}
        </Table>
        {!loading && !data?.items.length && <EmptyState title={tr("لا توجد قيود", "No entries")} />}
        {pages > 1 && <div className="flex items-center justify-between border-t border-line p-3 text-sm">
          <span className="text-muted">{data?.total} {tr("قيد", "entries")}</span>
          <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("السابق", "Prev")}</Button><span className="tabular">{page} / {pages}</span><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{tr("التالي", "Next")}</Button></div>
        </div>}
      </Card>
      <EntryModal e={open} onClose={() => setOpen(null)} onReversed={() => { setOpen(null); reload(); }} />
      <ManualModal open={create} onClose={() => setCreate(false)} onDone={() => { setCreate(false); reload(); }} />
    </>
  );
}

function EntryModal({ e, onClose, onReversed }: { e: Entry | null; onClose: () => void; onReversed: () => void }) {
  const { tr, can, locale } = useSession();
  const money = useMoney();
  const [reason, setReason] = useState("");
  const { pending, run } = useSubmit();
  return (
    <Modal open={!!e} onClose={onClose} wide title={e ? `${e.code} — ${fmtDate(e.date, locale)}` : ""}
      footer={e && can("accounting.approve") && !e.reversalOfId && <div className="flex w-full flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder={tr("سبب العكس", "Reversal reason")} value={reason} onChange={(x) => setReason(x.target.value)} />
        <Button variant="danger" disabled={reason.trim().length < 2} loading={pending} onClick={async () => { if (await run(() => api(`/api/accounting/journals/${e.id}/reverse`, { method: "POST", body: { reason } }), tr("تم عكس القيد", "Entry reversed"))) { setReason(""); onReversed(); } }}>{tr("عكس القيد", "Reverse entry")}</Button>
      </div>}>
      {e && <>
        <p className="mb-2 text-sm">{e.description}</p>
        <Table head={[tr("الحساب", "Account"), tr("البيان", "Line note"), tr("مدين", "Debit"), tr("دائن", "Credit")]}>
          {e.lines.map((l) => <Tr key={l.id}><Td><span dir="ltr" className="font-mono text-xs">{l.account.code}</span> {l.account.name}</Td><Td className="text-muted">{l.description ?? ""}</Td>
            <Td className="tabular">{Number(l.debit) ? money(l.debit) : ""}</Td><Td className="tabular">{Number(l.credit) ? money(l.credit) : ""}</Td></Tr>)}
          <Tr><Td className="font-semibold">{tr("الإجمالي", "Total")}</Td><Td /><Td className="tabular font-semibold">{money(e.lines.reduce((s, l) => s + Number(l.debit), 0))}</Td><Td className="tabular font-semibold">{money(e.lines.reduce((s, l) => s + Number(l.credit), 0))}</Td></Tr>
        </Table>
      </>}
    </Modal>
  );
}

type L = { accountId: string; debit: string; credit: string; description: string };
function ManualModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const money = useMoney();
  const accounts = useLeafAccounts(open);
  const blank = (): L => ({ accountId: "", debit: "", credit: "", description: "" });
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), description: "", opening: false });
  const [lines, setLines] = useState<L[]>([blank(), blank()]);
  const { pending, run } = useSubmit();
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0), cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const set = (i: number, p: Partial<L>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <Modal open={open} onClose={onClose} wide title={tr("قيد يدوي", "Manual journal entry")}
      footer={<><span className={`me-auto text-sm tabular ${Math.abs(dr - cr) < 0.005 ? "text-success" : "text-danger"}`}>{tr("مدين", "Dr")} {money(dr)} · {tr("دائن", "Cr")} {money(cr)}</span>
        <Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="mj" type="submit" disabled={Math.abs(dr - cr) >= 0.005 || dr === 0} loading={pending}>{tr("ترحيل", "Post")}</Button></>}>
      <form id="mj" className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...f, lines: lines.filter((l) => l.accountId).map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || null })) };
        if (await run(() => api("/api/accounting/journals", { method: "POST", body }), tr("تم ترحيل القيد", "Entry posted"))) { setLines([blank(), blank()]); setF({ ...f, description: "" }); onDone(); }
      }}>
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field label={tr("التاريخ", "Date")}><Input type="date" dir="ltr" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label={tr("البيان", "Description")}><Input required minLength={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <Checkbox label={tr("قيد افتتاحي (أرصدة بداية)", "Opening balances entry")} checked={f.opening} onChange={(e) => setF({ ...f, opening: e.target.checked })} />
        {lines.map((l, i) => (
          <div key={i} className="grid items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[2.4fr_1fr_1fr_1.6fr_auto]">
            <Select required value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}><option value="">{tr("الحساب", "Account")}</option><AccountOptions accounts={accounts} /></Select>
            <Input type="number" min={0} step="any" dir="ltr" placeholder={tr("مدين", "Debit")} value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input type="number" min={0} step="any" dir="ltr" placeholder={tr("دائن", "Credit")} value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <Input placeholder={tr("ملاحظة السطر", "Line note")} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
            <Button type="button" size="sm" variant="ghost" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="secondary" onClick={() => setLines([...lines, blank()])}>+ {tr("سطر", "Line")}</Button>
      </form>
    </Modal>
  );
}
