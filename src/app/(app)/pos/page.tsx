"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, Input, Modal, Select } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import ClientPicker, { type PickedClient } from "@/components/clients/ClientPicker";
import type { Catalog, Staff } from "@/components/appointments/shared";
import { useMoney } from "@/components/billing/useMoney";
import { api, ApiError } from "@/lib/client";
import { PAY_METHOD } from "@/lib/labels4";

type Product = { id: string; name: string; price: string; sku: string | null; barcode: string | null; isActive: boolean };
type CartLine = { key: string; kind: "SERVICE" | "PRODUCT"; refId: string; name: string; price: number; qty: number; discount: number; performedById: string };

export default function PosPage() {
  const { tr, can, features } = useSession();
  const money = useMoney();
  const ok = can("pos.create") && can("invoices.create");
  const catalog = useResource<Catalog>(ok ? "/api/catalog?active=1" : null);
  const products = useResource<Product[]>(ok ? "/api/products?active=1" : null);
  const staff = useResource<Staff[]>(ok ? "/api/staff" : null);
  const [tab, setTab] = useState<"services" | "products">("services");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [client, setClient] = useState<PickedClient | null>(null);
  const [seller, setSeller] = useState("");
  const [discount, setDiscount] = useState(0);
  const [coupon, setCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [points, setPoints] = useState(0);
  const [loyalty, setLoyalty] = useState<{ balance: number; pointValue: string; minRedeemPoints: number } | null>(null);
  const [pay, setPay] = useState(false);
  const [done, setDone] = useState<{ id: string; code: string; total: string; paidTotal: string } | null>(null);

  useEffect(() => {
    setLoyalty(null); setPoints(0); setCoupon(null);
    if (client && features.includes("loyalty") && can("loyalty.view")) api<{ balance: number; pointValue: string; minRedeemPoints: number }>(`/api/clients/${client.id}/loyalty`).then(setLoyalty).catch(() => {});
  }, [client, features, can]);
  useEffect(() => setCoupon(null), [cart]); // re-validate when the cart changes

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (tab === "services") return (catalog.data?.services ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.nameEn?.toLowerCase().includes(s)).map((x) => ({ id: x.id, name: x.name, price: Number(x.price), sub: `${x.durationMin} ${tr("د", "min")}`, color: x.color }));
    return (products.data ?? []).filter((x) => (x as { isSellable?: boolean }).isSellable !== false).filter((x) => !s || x.name.toLowerCase().includes(s) || x.sku?.toLowerCase().includes(s) || x.barcode === s).map((x) => ({ id: x.id, name: x.name, price: Number(x.price), sub: x.sku ?? "", color: null as string | null }));
  }, [tab, q, catalog.data, products.data, tr]);

  const add = (it: { id: string; name: string; price: number }) => {
    const kind = tab === "services" ? "SERVICE" : "PRODUCT";
    setCart((c) => {
      const ex = c.find((l) => l.refId === it.id && l.kind === kind);
      if (ex) return c.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: `${kind}-${it.id}-${Date.now()}`, kind, refId: it.id, name: it.name, price: it.price, qty: 1, discount: 0, performedById: "" }];
    });
  };
  const subtotal = cart.reduce((s, l) => s + l.qty * l.price - l.discount, 0);
  const pointsValue = loyalty ? Math.min(points * Number(loyalty.pointValue), Math.max(0, subtotal - discount - (coupon?.discount ?? 0))) : 0;
  const total = Math.max(0, subtotal - discount - (coupon?.discount ?? 0) - pointsValue); // tax (if any) is added by the server

  async function applyCoupon() {
    setCouponErr(null);
    try {
      const r = await api<{ code: string; discount: string }>("/api/coupons/check", { body: { code: couponInput, clientId: client?.id ?? null, lines: cart.map((l) => ({ kind: l.kind, serviceId: l.kind === "SERVICE" ? l.refId : null, amount: l.qty * l.price - l.discount })) } });
      setCoupon({ code: r.code, discount: Number(r.discount) });
    } catch (e) { setCouponErr(e instanceof Error ? e.message : String(e)); }
  }

  if (!ok) return <Forbidden />;
  const body = () => ({
    clientId: client?.id ?? null, salesStaffId: seller || null, discountAmount: discount, couponCode: coupon?.code ?? null, redeemPoints: points,
    lines: cart.map((l) => ({ kind: l.kind, ...(l.kind === "SERVICE" ? { serviceId: l.refId } : { productId: l.refId }), quantity: l.qty, unitPrice: l.price, discount: l.discount, performedById: l.performedById || null })),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="me-auto text-xl font-semibold">{tr("نقطة البيع", "Point of sale")}</h1>
          <div className="flex rounded-lg border border-line p-0.5">
            {([["services", tr("الخدمات", "Services")], ["products", tr("المنتجات", "Products")]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1 text-sm ${tab === k ? "bg-brand text-white" : "text-muted"}`}>{l}</button>
            ))}
          </div>
          <Input className="max-w-xs" autoFocus placeholder={tr("بحث أو مسح باركود…", "Search or scan barcode…")} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && items.length === 1) { add(items[0]); setQ(""); } }} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((it) => (
            <button key={it.id} onClick={() => add(it)} className="rounded-xl border border-line bg-surface p-3 text-start transition hover:border-brand hover:shadow-sm">
              <span className="mb-2 block h-1 w-8 rounded-full" style={{ background: it.color ?? "var(--series-1)" }} />
              <p className="line-clamp-2 text-sm font-medium">{it.name}</p>
              <p className="mt-1 text-xs text-muted">{it.sub}</p>
              <p className="mt-2 font-semibold tabular">{money(it.price)}</p>
            </button>
          ))}
          {items.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">{tr("لا توجد عناصر", "Nothing found")}</p>}
        </div>
      </div>

      <Card className="h-fit p-4 lg:sticky lg:top-20">
        <div className="mb-3 space-y-2">
          <ClientPicker value={client} onChange={setClient} />
          {!client && <p className="text-xs text-muted">{tr("بدون عميل = بيع نقدي مباشر (يُدفع بالكامل).", "No client = walk-in sale (paid in full).")}</p>}
          {loyalty && <p className="text-xs text-muted">{tr("رصيد النقاط:", "Points:")} <b className="tabular">{loyalty.balance}</b> ({money(loyalty.balance * Number(loyalty.pointValue))})</p>}
        </div>
        {cart.length === 0 ? <p className="py-10 text-center text-sm text-muted">{tr("السلة فارغة — اختر خدمة أو منتجاً", "Cart is empty")}</p> : (
          <ul className="mb-3 max-h-[40vh] divide-y divide-line overflow-y-auto">
            {cart.map((l) => (
              <li key={l.key} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{l.name}</p>
                  <button className="text-muted hover:text-danger" aria-label="remove" onClick={() => setCart(cart.filter((x) => x !== l))}>×</button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-lg border border-line">
                    <button className="px-2" onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>−</button>
                    <span className="w-8 text-center text-sm tabular">{l.qty}</span>
                    <button className="px-2" onClick={() => setCart(cart.map((x) => (x === l ? { ...x, qty: x.qty + 1 } : x)))}>+</button>
                  </div>
                  <span className="text-xs text-muted tabular">× {money(l.price)}</span>
                  <span className="ms-auto text-sm font-medium tabular">{money(l.qty * l.price - l.discount)}</span>
                </div>
                {l.kind === "SERVICE" && (
                  <Select className="mt-1 h-8 text-xs" value={l.performedById} onChange={(e) => setCart(cart.map((x) => (x === l ? { ...x, performedById: e.target.value } : x)))}>
                    <option value="">{tr("المنفّذ (للعمولة)", "Performed by (commission)")}</option>
                    {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
                  </Select>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 border-t border-line pt-3 text-sm">
          <Select className="h-9" value={seller} onChange={(e) => setSeller(e.target.value)}>
            <option value="">{tr("موظف البيع (اختياري)", "Sales staff (optional)")}</option>
            {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </Select>
          <div className="flex items-center gap-2"><span className="w-24 text-muted">{tr("خصم", "Discount")}</span><Input className="h-9" type="number" min={0} dir="ltr" value={discount || ""} onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))} /></div>
          {features.includes("coupons") && (
            <div>
              <div className="flex gap-2">
                <Input className="h-9 min-w-0 flex-1 uppercase" dir="ltr" placeholder={tr("كود الخصم", "Coupon code")} value={couponInput} onChange={(e) => setCouponInput(e.target.value)} />
                <Button size="sm" variant="secondary" disabled={!couponInput || !cart.length} onClick={applyCoupon}>{tr("تطبيق", "Apply")}</Button>
              </div>
              {coupon && <p className="mt-1 text-xs text-success">{coupon.code}: −{money(coupon.discount)} <button className="text-muted" onClick={() => setCoupon(null)}>×</button></p>}
              {couponErr && <p className="mt-1 text-xs text-danger">{couponErr}</p>}
            </div>
          )}
          {loyalty && loyalty.balance >= loyalty.minRedeemPoints && loyalty.balance > 0 && (
            <div className="flex items-center gap-2"><span className="w-24 text-muted">{tr("استبدال نقاط", "Redeem pts")}</span>
              <Input className="h-9" type="number" min={0} max={loyalty.balance} dir="ltr" value={points || ""} onChange={(e) => setPoints(Math.min(loyalty.balance, Math.max(0, Math.floor(Number(e.target.value)))))} /></div>
          )}
          <dl className="space-y-1 pt-2">
            <div className="flex justify-between"><dt className="text-muted">{tr("المجموع", "Subtotal")}</dt><dd className="tabular">{money(subtotal)}</dd></div>
            {discount + (coupon?.discount ?? 0) + pointsValue > 0 && <div className="flex justify-between"><dt className="text-muted">{tr("الخصومات", "Discounts")}</dt><dd className="tabular">−{money(discount + (coupon?.discount ?? 0) + pointsValue)}</dd></div>}
            <div className="flex justify-between text-lg font-semibold"><dt>{tr("الإجمالي", "Total")}</dt><dd className="tabular">{money(total)}</dd></div>
          </dl>
          <Button className="w-full" disabled={!cart.length} onClick={() => setPay(true)}>{tr("الدفع", "Checkout")}</Button>
          {cart.length > 0 && <button className="w-full text-xs text-muted" onClick={() => { setCart([]); setClient(null); setDiscount(0); setCoupon(null); setCouponInput(""); }}>{tr("تفريغ السلة", "Clear")}</button>}
        </div>
      </Card>

      <PayModal open={pay} total={total} walkIn={!client} onClose={() => setPay(false)} body={body}
        onDone={(inv) => { setPay(false); setDone(inv); setCart([]); setClient(null); setDiscount(0); setCoupon(null); setCouponInput(""); setPoints(0); }} />
      <Modal open={!!done} onClose={() => setDone(null)} title={tr("تمت عملية البيع", "Sale complete")}
        footer={<><Button variant="secondary" onClick={() => setDone(null)}>{tr("بيع جديد", "New sale")}</Button>
          <a href={`/print/invoices/${done?.id}`} target="_blank" rel="noreferrer"><Button>{tr("طباعة الفاتورة", "Print invoice")}</Button></a></>}>
        {done && <div className="space-y-2 text-center"><p className="text-3xl">✓</p><p className="font-semibold" dir="ltr">{done.code}</p><p className="tabular">{money(done.total)} · {tr("مدفوع", "paid")} {money(done.paidTotal)}</p></div>}
      </Modal>
    </div>
  );
}

function PayModal({ open, total, walkIn, onClose, body, onDone }: { open: boolean; total: number; walkIn: boolean; onClose: () => void; body: () => Record<string, unknown>; onDone: (inv: { id: string; code: string; total: string; paidTotal: string }) => void }) {
  const { tr } = useSession();
  const money = useMoney();
  const [rows, setRows] = useState<{ method: string; amount: number; reference: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { pending, run } = useSubmit();
  useEffect(() => { if (open) { setRows([{ method: "CASH", amount: total, reference: "" }]); setError(null); } }, [open, total]);
  const paid = rows.reduce((s, r) => s + (r.amount || 0), 0);
  return (
    <Modal open={open} onClose={onClose} title={tr("الدفع", "Payment")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("رجوع", "Back")}</Button><Button loading={pending} disabled={paid > total + 0.001 || (walkIn && paid + 0.001 < total)} onClick={async () => {
        setError(null);
        try {
          const inv = await api<{ id: string; code: string; total: string; paidTotal: string }>("/api/pos/checkout", { body: { ...body(), payments: rows.filter((r) => r.amount > 0).map((r) => ({ method: r.method, amount: r.amount, reference: r.reference || null })) } });
          await run(async () => inv, tr("تم إصدار الفاتورة", "Invoice issued"));
          onDone(inv);
        } catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
      }}>{tr("تأكيد وإصدار الفاتورة", "Confirm & issue")}</Button></>}>
      <div className="space-y-3 text-sm">
        <p className="text-center text-2xl font-semibold tabular">{money(total)}</p>
        <p className="text-center text-xs text-muted">{tr("الضريبة (إن وجدت) تُضاف تلقائياً حسب إعدادات المؤسسة.", "Tax (if configured) is added automatically.")}</p>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Select className="w-32" value={r.method} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>
              {Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}
            </Select>
            <Input type="number" min={0} step="any" dir="ltr" value={r.amount || ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
            {r.method !== "CASH" && <Input className="w-32" placeholder={tr("مرجع", "Ref")} value={r.reference} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />}
            {rows.length > 1 && <Button variant="ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</Button>}
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setRows([...rows, { method: "CARD", amount: Math.max(0, Math.round((total - paid) * 100) / 100), reference: "" }])}>+ {tr("طريقة دفع أخرى", "Split payment")}</Button>
        <div className="flex justify-between rounded-lg bg-surface-2 p-2"><span>{tr("المتبقي", "Remaining")}</span><b className="tabular">{money(Math.max(0, total - paid))}</b></div>
        {!walkIn && paid < total && <p className="text-xs text-warning">{tr("سيُسجّل المتبقي كدين على العميل.", "The remainder will be recorded as the client's balance due.")}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
