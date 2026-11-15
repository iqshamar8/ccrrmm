"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, EmptyState, Input, LoadingRows, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { useMoney } from "@/components/billing/useMoney";
import { fmtDate } from "@/lib/i18n";
import { INVOICE_STATUS, INVOICE_TYPE, l4, t4 } from "@/lib/labels4";

type Inv = { id: string; code: string | null; status: string; type: string; total: string; paidTotal: string; balance: string; issuedAt: string | null; createdAt: string; dueDate: string | null; client: { id: string; fullName: string } | null; branch: { name: string } };
type Recv = { items: { id: string; code: string; client: { id: string; fullName: string; phone: string } | null; balance: string; total: string; dueDate: string | null; daysOverdue: number; installments: number }[];
  byClient: { client: { id: string; fullName: string; phone: string } | null; balance: string; invoices: number; maxOverdue: number }[];
  buckets: Record<"current" | "d1_30" | "d31_60" | "d61_90" | "d90p", string>; total: string };

export default function InvoicesPage() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const router = useRouter();
  const [tab, setTab] = useState<"all" | "receivables">("all");
  const [q, setQ] = useState(""); const [dq, setDq] = useState("");
  const [status, setStatus] = useState(""); const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setPage(1), [dq, status, type]);
  const ok = can("invoices.view");
  const list = useResource<{ items: Inv[]; total: number; sums: { total: string; paid: string } }>(ok && tab === "all" ? `/api/invoices?q=${encodeURIComponent(dq)}&status=${status}&type=${type}&page=${page}` : null);
  const recv = useResource<Recv>(ok && tab === "receivables" ? "/api/receivables" : null);
  if (!ok) return <Forbidden />;

  return (
    <>
      <PageHeader title={tr("الفواتير والمبيعات", "Invoices & sales")} subtitle={tr("الفواتير، الدفعات، المستحقات والاسترجاع", "Invoices, payments, receivables and refunds")}
        actions={<>
          {can("pos.create") && <Link href="/pos"><Button variant="secondary">{tr("نقطة البيع", "POS")}</Button></Link>}
          {can("invoices.create") && <Link href="/invoices/new"><Button>+ {tr("فاتورة جديدة", "New invoice")}</Button></Link>}
        </>} />
      <div className="mb-4 flex gap-1 border-b border-line">
        {([["all", tr("كل الفواتير", "All invoices")], ["receivables", tr("المستحقات والديون", "Receivables")]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>
        ))}
      </div>
      {tab === "all" ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <Input className="max-w-xs" placeholder={tr("رقم الفاتورة أو اسم/هاتف العميل…", "Invoice no. or client…")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{tr("كل الحالات", "All statuses")}</option>{Object.entries(INVOICE_STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
            <Select className="w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="">{tr("كل الأنواع", "All types")}</option>{Object.entries(INVOICE_TYPE).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select>
            {list.data && <span className="ms-auto text-xs text-muted">{tr("الإجمالي", "Total")} <b className="tabular">{money(list.data.sums.total)}</b> · {tr("المحصّل", "Collected")} <b className="tabular">{money(list.data.sums.paid)}</b></span>}
          </div>
          <Table head={[tr("الرقم", "No."), tr("العميل", "Client"), tr("النوع", "Type"), tr("التاريخ", "Date"), tr("الإجمالي", "Total"), tr("المتبقي", "Balance"), tr("الحالة", "Status")]}>
            {list.loading && !list.data ? <LoadingRows cols={7} /> : list.data?.items.map((i) => (
              <Tr key={i.id} onClick={() => router.push(`/invoices/${i.id}`)}>
                <Td className="font-medium"><span dir="ltr">{i.code ?? tr("مسودة", "Draft")}</span></Td>
                <Td>{i.client?.fullName ?? <span className="text-muted">{tr("عميل نقدي", "Walk-in")}</span>}</Td>
                <Td className="text-muted">{l4(INVOICE_TYPE, i.type, locale)}</Td>
                <Td className="whitespace-nowrap text-muted">{fmtDate(i.issuedAt ?? i.createdAt, locale)}</Td>
                <Td className="tabular">{money(i.total)}</Td>
                <Td className={`tabular ${Number(i.balance) > 0 && !["DRAFT", "CANCELLED"].includes(i.status) ? "font-medium text-warning" : "text-muted"}`}>{["DRAFT", "CANCELLED"].includes(i.status) ? "—" : money(i.balance)}</Td>
                <Td><Badge tone={t4(INVOICE_STATUS, i.status)}>{l4(INVOICE_STATUS, i.status, locale)}</Badge></Td>
              </Tr>
            ))}
          </Table>
          {!list.loading && list.data?.items.length === 0 && <EmptyState title={tr("لا توجد فواتير", "No invoices")} />}
          {list.data && list.data.total > 50 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
              <span className="text-muted">{page} / {Math.ceil(list.data.total / 50)}</span>
              <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("السابق", "Prev")}</Button><Button size="sm" variant="secondary" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>{tr("التالي", "Next")}</Button></div>
            </div>
          )}
        </Card>
      ) : recv.data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            <StatCard label={tr("إجمالي المستحقات", "Total receivable")} value={<span className="text-xl">{money(recv.data.total)}</span>} />
            {([["current", "غير متأخرة", "Not due"], ["d1_30", "1–30 يوم", "1–30 d"], ["d31_60", "31–60 يوم", "31–60 d"], ["d61_90", "61–90 يوم", "61–90 d"], ["d90p", "+90 يوم", "90+ d"]] as const).map(([k, ar, en]) => (
              <StatCard key={k} label={tr(ar, en)} value={<span className={`text-xl ${k !== "current" && Number(recv.data!.buckets[k]) > 0 ? "text-danger" : ""}`}>{money(recv.data!.buckets[k])}</span>} />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="border-b border-line px-4 py-3 font-medium">{tr("حسب العميل", "By client")}</div>
              <Table head={[tr("العميل", "Client"), tr("الفواتير", "Invoices"), tr("أقدم تأخير", "Oldest overdue"), tr("المستحق", "Balance")]}>
                {recv.data.byClient.map((c, i) => (
                  <Tr key={c.client?.id ?? i} onClick={c.client ? () => router.push(`/clients/${c.client!.id}`) : undefined}>
                    <Td>{c.client?.fullName ?? tr("عميل نقدي", "Walk-in")}<p className="text-xs text-muted" dir="ltr">{c.client?.phone}</p></Td><Td className="tabular">{c.invoices}</Td>
                    <Td>{c.maxOverdue ? <Badge tone="red">{c.maxOverdue} {tr("يوم", "d")}</Badge> : "—"}</Td><Td className="font-medium tabular">{money(c.balance)}</Td>
                  </Tr>
                ))}
              </Table>
            </Card>
            <Card>
              <div className="border-b border-line px-4 py-3 font-medium">{tr("الفواتير غير المسددة", "Unpaid invoices")}</div>
              <Table head={[tr("الرقم", "No."), tr("العميل", "Client"), tr("الاستحقاق", "Due"), tr("المتبقي", "Balance")]}>
                {recv.data.items.map((i) => (
                  <Tr key={i.id} onClick={() => router.push(`/invoices/${i.id}`)}>
                    <Td><span dir="ltr">{i.code}</span>{i.installments > 0 && <p className="text-xs text-muted">{tr("أقساط", "Installments")}: {i.installments}</p>}</Td>
                    <Td>{i.client?.fullName ?? "—"}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(i.dueDate, locale)} {i.daysOverdue > 0 && <Badge tone="red">{i.daysOverdue} {tr("يوم", "d")}</Badge>}</Td>
                    <Td className="font-medium tabular">{money(i.balance)}</Td>
                  </Tr>
                ))}
              </Table>
              {recv.data.items.length === 0 && <EmptyState title={tr("لا توجد مستحقات 🎉", "Nothing outstanding")} />}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
