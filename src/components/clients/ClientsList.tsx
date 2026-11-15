"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, LoadingRows, Modal, PageHeader, Select, Input, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { csvToClientRows } from "@/lib/csv";
import { fmtDate } from "@/lib/i18n";
import { CLIENT_STATUS, SOURCES, sourceLabel } from "@/lib/labels2";
import ClientForm from "./ClientForm";

type Row = {
  id: string; code: string; fullName: string; phone: string; status: string; source: string | null; category: string | null; tags: string[];
  createdAt: string; lastVisitAt: string | null; branch: { name: string }; owner: { fullName: string } | null;
};

export default function ClientsList({ mode }: { mode: "clients" | "leads" }) {
  const s = useSession();
  const { tr, locale, can } = s;
  const router = useRouter();
  const leads = mode === "leads";
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState(leads ? "LEAD" : "");
  const [source, setSource] = useState("");
  const [tag, setTag] = useState("");
  const [branchId, setBranchId] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [debounced, status, source, tag, branchId, sort]);

  const params = useMemo(() => new URLSearchParams({ q: debounced, status, source, tag, branchId, sort, page: String(page), pageSize: "25" }).toString(), [debounced, status, source, tag, branchId, sort, page]);
  const allowed = can("clients.view");
  const { data, loading, reload } = useResource<{ items: Row[]; total: number; page: number; pageSize: number }>(allowed ? `/api/clients?${params}` : null);
  const tags = useResource<{ tag: string; count: number }[]>(allowed ? "/api/clients/tags" : null);
  const branches = useResource<{ id: string; name: string }[]>(allowed && can("branches.view") ? "/api/branches" : null);
  const convert = useSubmit();
  if (!allowed) return <Forbidden />;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title={leads ? tr("العملاء المحتملون", "Leads") : tr("العملاء والمرضى", "Clients & patients")}
        subtitle={data ? `${data.total} ${leads ? tr("عميل محتمل", "leads") : tr("ملف", "records")}` : undefined}
        actions={<>
          {!leads && can("clients.create") && <Button variant="secondary" onClick={() => setImportOpen(true)}>{tr("استيراد", "Import")}</Button>}
          {!leads && can("clients.export") && <a href={`/api/clients/export?${params}`}><Button variant="secondary">{tr("تصدير CSV", "Export CSV")}</Button></a>}
          {can("clients.create") && <Button onClick={() => setOpen(true)}>+ {leads ? tr("عميل محتمل", "New lead") : tr("عميل جديد", "New client")}</Button>}
        </>}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالاسم أو الهاتف أو الرمز…", "Search name, phone or code…")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {!leads && (
            <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{tr("كل الحالات", "All statuses")}</option>
              {Object.entries(CLIENT_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
            </Select>
          )}
          <Select className="w-auto" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{tr("كل المصادر", "All sources")}</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
          </Select>
          {!!tags.data?.length && (
            <Select className="w-auto" value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">{tr("كل الوسوم", "All tags")}</option>
              {tags.data.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
            </Select>
          )}
          {branches.data && branches.data.length > 1 && (
            <Select className="w-auto" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">{tr("كل الفروع", "All branches")}</option>
              {branches.data.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">{tr("الأحدث تسجيلاً", "Newest")}</option>
            <option value="lastVisit">{tr("آخر زيارة", "Last visit")}</option>
            <option value="name">{tr("الاسم", "Name")}</option>
          </Select>
        </div>
        <Table head={[tr("العميل", "Client"), tr("الهاتف", "Phone"), tr("الحالة", "Status"), tr("المصدر", "Source"), tr("الوسوم", "Tags"), tr("الفرع", "Branch"), leads ? tr("تاريخ التسجيل", "Registered") : tr("آخر زيارة", "Last visit"), ""]}>
          {loading && !data ? <LoadingRows cols={8} /> : data?.items.map((c) => (
            <Tr key={c.id} onClick={() => router.push(`/clients/${c.id}`)}>
              <Td><p className="font-medium">{c.fullName} {c.category === "VIP" && <Badge tone="amber">VIP</Badge>}</p><p className="text-xs text-muted" dir="ltr">{c.code}</p></Td>
              <Td className="text-muted whitespace-nowrap"><span dir="ltr">{c.phone}</span></Td>
              <Td><Badge tone={CLIENT_STATUS[c.status]?.tone}>{tr(CLIENT_STATUS[c.status].ar, CLIENT_STATUS[c.status].en)}</Badge></Td>
              <Td className="text-muted">{sourceLabel(c.source, locale)}</Td>
              <Td><div className="flex flex-wrap gap-1">{c.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</div></Td>
              <Td className="text-muted">{c.branch.name}</Td>
              <Td className="text-muted whitespace-nowrap">{fmtDate(leads ? c.createdAt : c.lastVisitAt, locale)}</Td>
              <Td className="text-end">
                {leads && can("clients.update") && (
                  <Button size="sm" variant="secondary" loading={convert.pending} onClick={async (e) => {
                    e.stopPropagation();
                    if (await convert.run(() => api(`/api/clients/${c.id}`, { method: "PATCH", body: { status: "ACTIVE" } }), tr("تم التحويل إلى عميل فعلي", "Converted to client"))) reload();
                  }}>{tr("تحويل لعميل", "Convert")}</Button>
                )}
              </Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.items.length === 0 && (
          <EmptyState title={debounced || source || tag ? tr("لا توجد نتائج مطابقة", "No matching results") : leads ? tr("لا يوجد عملاء محتملون", "No leads yet") : tr("لا يوجد عملاء بعد", "No clients yet")}
            text={tr("أضف أول ملف أو غيّر عوامل التصفية.", "Add the first record or change the filters.")}
            action={can("clients.create") && <Button onClick={() => setOpen(true)}>{tr("إضافة", "Add")}</Button>} />
        )}
        {data && pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">{tr("صفحة", "Page")} {page} / {pages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("السابق", "Previous")}</Button>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{tr("التالي", "Next")}</Button>
            </div>
          </div>
        )}
      </Card>
      <ClientForm open={open} client={null} defaultStatus={leads ? "LEAD" : "ACTIVE"} onClose={() => setOpen(false)} onSaved={(c) => { setOpen(false); router.push(`/clients/${c.id}`); }} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { reload(); tags.reload(); }} />
    </>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { tr } = useSession();
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [result, setResult] = useState<{ created: number; skipped: { row: number; reason: string }[] } | null>(null);
  const { pending, run } = useSubmit();
  useEffect(() => { if (open) { setRows([]); setResult(null); setUnknown([]); } }, [open]);

  async function onFile(file: File) {
    const parsed = csvToClientRows(await file.text());
    setRows(parsed.rows); setUnknown(parsed.unknown); setResult(null);
  }
  async function submit() {
    const r = await run(() => api<{ created: number; skipped: { row: number; reason: string }[] }>("/api/clients/import", { body: { rows } }));
    if (r) { setResult(r); onDone(); }
  }
  const sample = "fullName,phone,email,gender,birthDate,source,tags,notes\nسارة علي,+9647701234567,sara@mail.com,FEMALE,1995-04-12,instagram,VIP;ليزر,\n";

  return (
    <Modal open={open} onClose={onClose} title={tr("استيراد العملاء من CSV", "Import clients from CSV")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إغلاق", "Close")}</Button>{!result && <Button disabled={!rows.length} loading={pending} onClick={submit}>{tr(`استيراد ${rows.length} صف`, `Import ${rows.length} rows`)}</Button>}</>}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">{tr("الأعمدة المدعومة: الاسم، الهاتف، البريد، الجنس، تاريخ الميلاد، المصدر، الوسوم، ملاحظات (بالعربية أو الإنجليزية). يتم تخطي الأرقام المكررة تلقائياً. الحد الأقصى 2000 صف.",
          "Columns: fullName, phone, email, gender, birthDate, source, tags, notes (Arabic or English headers). Duplicate phones are skipped. Max 2000 rows.")}</p>
        <a className="text-brand underline" download="clients-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + sample)}`}>{tr("تحميل نموذج", "Download template")}</a>
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="block w-full text-sm" />
        {rows.length > 0 && !result && <p>{tr(`تم قراءة ${rows.length} صف.`, `${rows.length} rows read.`)} {unknown.length > 0 && <span className="text-warning">{tr("أعمدة متجاهلة:", "Ignored columns:")} {unknown.join(", ")}</span>}</p>}
        {result && (
          <div className="rounded-lg bg-surface-2 p-3">
            <p className="font-medium text-success">{tr(`تم إنشاء ${result.created} عميل`, `${result.created} clients created`)}</p>
            {result.skipped.length > 0 && (
              <>
                <p className="mt-2">{tr(`تم تخطي ${result.skipped.length} صف:`, `${result.skipped.length} rows skipped:`)}</p>
                <ul className="mt-1 max-h-40 overflow-auto text-xs text-muted">{result.skipped.map((x) => <li key={x.row}>#{x.row}: {x.reason}</li>)}</ul>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
