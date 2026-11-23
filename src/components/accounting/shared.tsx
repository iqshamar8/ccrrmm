"use client";
import Link from "next/link";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, LoadingBlock, Modal, Table, Td, Tr } from "@/components/ui";
import { useMoney } from "@/components/billing/useMoney";
import { fmtDate } from "@/lib/i18n";

export type Account = { id: string; code: string; name: string; nameEn: string | null; type: AccountType; parentId: string | null; isGroup: boolean; systemKey: string | null; isActive: boolean; debit: string; credit: string; balance: string };
export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type CashAccount = { id: string; kind: "CASH" | "BANK"; name: string; branchId: string | null; bankName: string | null; accountNo: string | null; currency: string; isDefault: boolean; isActive: boolean; accountId: string; balance: string; branch: { name: string } | null };

export const TYPES: Record<AccountType, [string, string]> = {
  ASSET: ["أصول", "Assets"], LIABILITY: ["خصوم", "Liabilities"], EQUITY: ["حقوق ملكية", "Equity"], REVENUE: ["إيرادات", "Revenue"], EXPENSE: ["مصروفات", "Expenses"],
};
export const SOURCES: Record<string, [string, string]> = {
  MANUAL: ["قيد يدوي", "Manual"], OPENING: ["افتتاحي", "Opening"], INVOICE: ["فاتورة", "Invoice"], INVOICE_CANCEL: ["إلغاء فاتورة", "Invoice cancelled"], PAYMENT: ["تحصيل", "Collection"],
  REFUND: ["استرجاع", "Refund"], STOCK: ["مخزون", "Stock"], PAYROLL: ["استحقاق رواتب", "Payroll accrual"], PAYROLL_PAYMENT: ["صرف رواتب", "Payroll paid"], ADVANCE: ["سلفة", "Advance"], VOUCHER: ["سند", "Voucher"],
};
export const accName = (a: { name: string; nameEn: string | null }, locale: string) => (locale === "en" && a.nameEn ? a.nameEn : a.name);

export function AccountingTabs({ active }: { active: string }) {
  const { tr } = useSession();
  const tabs: [string, string, string][] = [
    ["/accounting", tr("الدليل المحاسبي", "Chart of accounts"), "chart"],
    ["/accounting/journals", tr("القيود اليومية", "Journal entries"), "journals"],
    ["/accounting/vouchers", tr("سندات القبض والصرف", "Vouchers & expenses"), "vouchers"],
    ["/accounting/cash", tr("الصناديق والبنوك والعملات", "Cash, banks & currencies"), "cash"],
    ["/accounting/reports", tr("التقارير المالية", "Financial reports"), "reports"],
  ];
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([href, label, key]) => <Link key={key} href={href} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active === key ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>)}
    </div>
  );
}

/** Leaf accounts for pickers, grouped by type. */
export function useLeafAccounts(enabled = true) {
  const r = useResource<Account[]>(enabled ? "/api/accounting/accounts" : null);
  return (r.data ?? []).filter((a) => !a.isGroup && a.isActive);
}

export function AccountOptions({ accounts, types }: { accounts: Account[]; types?: AccountType[] }) {
  const { tr, locale } = useSession();
  return <>{(Object.keys(TYPES) as AccountType[]).filter((t) => !types || types.includes(t)).map((t) => (
    <optgroup key={t} label={tr(TYPES[t][0], TYPES[t][1])}>
      {accounts.filter((a) => a.type === t).map((a) => <option key={a.id} value={a.id}>{a.code} — {accName(a, locale)}</option>)}
    </optgroup>
  ))}</>;
}

type Ledger = { account: { code: string; name: string; nameEn: string | null }; opening: string; closing: string; rows: { id: string; debit: string; credit: string; balance: string; description: string | null; entry: { code: string; date: string; description: string; source: string } }[] };

export function LedgerModal({ id, onClose, from, to }: { id: string | null; onClose: () => void; from?: string; to?: string }) {
  const { tr, locale } = useSession();
  const money = useMoney();
  const { data } = useResource<Ledger>(id ? `/api/accounting/accounts/${id}?from=${from ?? ""}&to=${to ?? ""}` : null);
  return (
    <Modal open={!!id} onClose={onClose} wide title={data ? `${data.account.code} — ${accName(data.account, locale)}` : tr("كشف حساب", "Account ledger")}>
      {!data ? <LoadingBlock cols={5} /> : <>
        <div className="mb-2 flex gap-4 text-sm"><span>{tr("رصيد أول المدة", "Opening")}: <b className="tabular">{money(data.opening)}</b></span><span>{tr("الرصيد الختامي", "Closing")}: <b className="tabular">{money(data.closing)}</b></span></div>
        <Table head={[tr("التاريخ", "Date"), tr("القيد", "Entry"), tr("البيان", "Description"), tr("مدين", "Debit"), tr("دائن", "Credit"), tr("الرصيد", "Balance")]}>
          {data.rows.slice(-500).reverse().map((r) => (
            <Tr key={r.id}>
              <Td className="text-muted">{fmtDate(r.entry.date, locale)}</Td>
              <Td><span dir="ltr" className="font-mono text-xs">{r.entry.code}</span> <Badge>{tr(...(SOURCES[r.entry.source] ?? [r.entry.source, r.entry.source]))}</Badge></Td>
              <Td className="text-sm">{r.description ?? r.entry.description}</Td>
              <Td className="tabular">{Number(r.debit) ? money(r.debit) : ""}</Td><Td className="tabular">{Number(r.credit) ? money(r.credit) : ""}</Td><Td className="tabular font-medium">{money(r.balance)}</Td>
            </Tr>
          ))}
        </Table>
        {data.rows.length > 500 && <p className="p-2 text-xs text-muted">{tr("يُعرض آخر 500 حركة — ضيّق الفترة لرؤية المزيد.", "Showing the latest 500 lines — narrow the period to see more.")}</p>}
      </>}
    </Modal>
  );
}
