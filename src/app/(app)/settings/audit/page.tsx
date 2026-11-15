"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/providers";
import { Button, Card, EmptyState, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { actionLabel } from "@/lib/labels";

type Row = { id: string; action: string; entity: string; entityId: string | null; userEmail: string | null; ip: string | null; createdAt: string; before: unknown; after: unknown };

const ENTITIES = ["User", "Role", "Branch", "Tenant", "TenantSubscription"];

export default function AuditPage() {
  const { tr, locale, can } = useSession();
  const [entity, setEntity] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(async (from?: string | null) => {
    setLoading(true);
    try {
      const r = await api<{ items: Row[]; nextCursor: string | null }>(`/api/audit?take=50&entity=${entity}${from ? `&cursor=${from}` : ""}`);
      setRows((x) => (from ? [...x, ...r.items] : r.items));
      setCursor(r.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [entity]);
  useEffect(() => { if (can("audit.view")) void load(); }, [load, can]);
  if (!can("audit.view")) return <Forbidden />;

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = ["time,action,entity,entityId,user,ip", ...rows.map((r) => [r.createdAt, r.action, r.entity, r.entityId, r.userEmail, r.ip].map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader title={tr("سجل العمليات", "Audit log")} subtitle={tr("كل عملية إضافة وتعديل وحذف ودخول: من قام بها ومتى", "Every create, update, delete and sign-in: who and when")}
        actions={can("audit.export") && <Button variant="secondary" onClick={exportCsv} disabled={!rows.length}>{tr("تصدير CSV", "Export CSV")}</Button>} />
      <Card>
        <div className="border-b border-line p-3">
          <Select className="max-w-[220px]" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">{tr("كل الأنواع", "All types")}</option>
            {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </div>
        <Table head={[tr("العملية", "Action"), tr("النوع", "Type"), tr("المستخدم", "User"), "IP", tr("الوقت", "Time"), ""]}>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>{actionLabel(r.action, locale)}</Td>
              <Td className="text-muted">{r.entity}</Td>
              <Td className="text-muted"><span dir="ltr">{r.userEmail ?? "system"}</span></Td>
              <Td className="text-muted"><span dir="ltr">{r.ip ?? "—"}</span></Td>
              <Td className="text-muted whitespace-nowrap">{fmtDate(r.createdAt, locale, true)}</Td>
              <Td className="text-end">{(r.before || r.after) ? <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>{tr("التفاصيل", "Details")}</Button> : null}</Td>
            </Tr>
          ))}
          {loading && <LoadingRows cols={6} rows={3} />}
        </Table>
        {!loading && rows.length === 0 && <EmptyState title={tr("لا توجد سجلات", "No records")} />}
        {cursor && !loading && <div className="border-t border-line p-3 text-center"><Button variant="secondary" onClick={() => load(cursor)}>{tr("تحميل المزيد", "Load more")}</Button></div>}
      </Card>
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={detail ? actionLabel(detail.action, locale) : ""}>
        {detail && (
          <div className="grid gap-4 md:grid-cols-2" dir="ltr">
            <div><p className="mb-1 text-xs text-muted">before</p><pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(detail.before, null, 2) ?? "—"}</pre></div>
            <div><p className="mb-1 text-xs text-muted">after</p><pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON.stringify(detail.after, null, 2) ?? "—"}</pre></div>
          </div>
        )}
      </Modal>
    </>
  );
}
