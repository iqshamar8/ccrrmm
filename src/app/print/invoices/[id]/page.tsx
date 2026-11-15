"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useState } from "react";
import { fmtDate, fmtMoney, type Locale } from "@/lib/i18n";
import { l4, PAY_METHOD } from "@/lib/labels4";
import type { InvoiceFull } from "@/app/(app)/invoices/[id]/page";

/** Printable invoice / receipt (A4 / 80mm-friendly). Outside the app shell. */
export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><Print id={id} /></Suspense>;
}

function Print({ id }: { id: string }) {
  const receiptId = useSearchParams().get("receipt");
  const [inv, setInv] = useState<InvoiceFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("ar");
  useEffect(() => {
    setLocale(document.documentElement.lang === "en" ? "en" : "ar");
    fetch(`/api/invoices/${id}`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error?.message ?? r.statusText); setInv(j.data); }).catch((e) => setErr(String(e.message ?? e)));
  }, [id]);
  useEffect(() => { if (inv) setTimeout(() => window.print(), 400); }, [inv]);
  const tr = (ar: string, en: string) => (locale === "ar" ? ar : en);
  if (err) return <p className="p-8 text-center">{err}</p>;
  if (!inv) return <p className="p-8 text-center">…</p>;
  const m = (v: string | number) => fmtMoney(Number(v), inv.currency, locale);
  const receipt = receiptId ? inv.payments.find((p) => p.id === receiptId) : null;

  return (
    <div className="mx-auto max-w-[800px] bg-white p-8 text-[13px] text-black print:p-0">
      <style>{`@media print { @page { margin: 14mm } .no-print { display: none } } body { background: #fff }`}</style>
      <div className="no-print mb-4 flex justify-end gap-2"><button onClick={() => window.print()} className="rounded border px-3 py-1">{tr("طباعة", "Print")}</button></div>
      <header className="mb-6 flex items-start justify-between border-b pb-4">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {inv.tenant.logoUrl && <img src={inv.tenant.logoUrl} alt="" className="mb-2 h-12" />}
          <p className="text-lg font-bold">{inv.tenant.name}</p>
          <p className="text-xs text-gray-600">{inv.branch.name}{inv.branch.address ? ` — ${inv.branch.address}` : inv.tenant.address ? ` — ${inv.tenant.address}` : ""}</p>
          <p className="text-xs text-gray-600" dir="ltr">{inv.branch.phone ?? inv.tenant.contactPhone} {inv.tenant.contactEmail}</p>
        </div>
        <div className="text-end">
          <p className="text-xl font-bold">{receipt ? (receipt.kind === "REFUND" ? tr("إيصال استرجاع", "Refund receipt") : tr("إيصال قبض", "Payment receipt")) : tr("فاتورة", "Invoice")}</p>
          <p dir="ltr" className="font-mono">{receipt ? receipt.receiptNo : inv.code}</p>
          <p className="text-xs text-gray-600">{fmtDate(receipt ? receipt.paidAt : inv.issuedAt ?? inv.createdAt, locale, true)}</p>
          {!receipt && inv.dueDate && <p className="text-xs text-gray-600">{tr("تاريخ الاستحقاق:", "Due:")} {fmtDate(inv.dueDate, locale)}</p>}
        </div>
      </header>
      <section className="mb-4">
        <p className="text-xs text-gray-500">{tr("العميل", "Bill to")}</p>
        <p className="font-semibold">{inv.client?.fullName ?? tr("عميل نقدي", "Walk-in customer")}</p>
        {inv.client && <p className="text-xs text-gray-600" dir="ltr">{inv.client.code} · {inv.client.phone}</p>}
      </section>

      {receipt ? (
        <section className="rounded border p-4">
          <p>{tr("استلمنا مبلغ", "Received the amount of")} <b>{m(receipt.amount)}</b> {tr("عن الفاتورة", "for invoice")} <b dir="ltr">{inv.code}</b></p>
          <p className="mt-2 text-gray-600">{tr("طريقة الدفع:", "Method:")} {l4(PAY_METHOD, receipt.method, locale)}{receipt.reference ? ` · ${receipt.reference}` : ""}</p>
          {receipt.note && <p className="mt-1 text-gray-600">{receipt.note}</p>}
          <p className="mt-3">{tr("المتبقي على الفاتورة:", "Invoice balance:")} <b>{m(inv.balance)}</b></p>
        </section>
      ) : (
        <>
          <table className="mb-4 w-full border-collapse">
            <thead><tr className="border-b bg-gray-50 text-start text-xs"><th className="p-2 text-start">{tr("البند", "Item")}</th><th className="p-2">{tr("الكمية", "Qty")}</th><th className="p-2">{tr("السعر", "Price")}</th><th className="p-2">{tr("الخصم", "Disc.")}</th><th className="p-2 text-end">{tr("المبلغ", "Amount")}</th></tr></thead>
            <tbody>{inv.lines.map((l) => (
              <tr key={l.id} className="border-b"><td className="p-2">{l.description}{l.performedBy && <span className="block text-[11px] text-gray-500">{l.performedBy.fullName}</span>}</td>
                <td className="p-2 text-center">{Number(l.quantity)}</td><td className="p-2 text-center">{m(l.unitPrice)}</td><td className="p-2 text-center">{Number(l.discount) ? m(l.discount) : "—"}</td><td className="p-2 text-end">{m(l.lineTotal)}</td></tr>
            ))}</tbody>
          </table>
          <div className="ms-auto w-72 space-y-1">
            <R k={tr("المجموع", "Subtotal")} v={m(inv.subtotal)} />
            {Number(inv.discountAmount) > 0 && <R k={tr("خصم", "Discount")} v={`−${m(inv.discountAmount)}`} />}
            {Number(inv.couponDiscount) > 0 && <R k={`${tr("كوبون", "Coupon")} ${inv.coupon?.code ?? ""}`} v={`−${m(inv.couponDiscount)}`} />}
            {Number(inv.loyaltyDiscount) > 0 && <R k={tr("نقاط الولاء", "Loyalty")} v={`−${m(inv.loyaltyDiscount)}`} />}
            {Number(inv.taxTotal) > 0 && <R k={inv.taxName} v={m(inv.taxTotal)} />}
            <div className="flex justify-between border-t pt-1 text-base font-bold"><span>{tr("الإجمالي", "Total")}</span><span>{m(inv.total)}</span></div>
            <R k={tr("المدفوع", "Paid")} v={m(inv.paidTotal)} />
            <div className="flex justify-between font-semibold"><span>{tr("المتبقي", "Balance due")}</span><span>{m(inv.balance)}</span></div>
          </div>
          {inv.installments.length > 0 && (
            <div className="mt-4"><p className="mb-1 font-semibold">{tr("جدول الأقساط", "Installments")}</p>
              {inv.installments.map((x) => <p key={x.id} className="text-xs">{x.seq}. {fmtDate(x.dueDate, locale)} — {m(x.amount)} ({x.status === "PAID" ? tr("مسدد", "paid") : tr("مستحق", "due")} {m(x.due)})</p>)}</div>
          )}
        </>
      )}
      {inv.footer && <p className="mt-8 border-t pt-3 text-center text-xs text-gray-600">{inv.footer}</p>}
      {inv.status === "CANCELLED" && <p className="mt-4 text-center text-lg font-bold text-red-600">{tr("ملغاة", "CANCELLED")}</p>}
    </div>
  );
}
const R = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between"><span className="text-gray-600">{k}</span><span>{v}</span></div>;
