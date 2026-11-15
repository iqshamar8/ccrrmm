"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession, useToast } from "@/components/providers";
import { Button } from "@/components/ui";
import { api, ApiError } from "@/lib/client";

/** Creates a draft invoice for a visit/program/subscription/surgery, or opens the existing one. */
export default function BillButton({ source, id, size = "md", variant = "secondary" }: {
  source: "appointment" | "program" | "subscription" | "surgery"; id: string; size?: "sm" | "md"; variant?: "primary" | "secondary";
}) {
  const { tr, can } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (!can("invoices.create")) return null;
  return (
    <Button size={size} variant={variant} loading={pending} onClick={async () => {
      setPending(true);
      try {
        const inv = await api<{ id: string }>("/api/invoices/bill", { body: { source, id } });
        router.push(`/invoices/${inv.id}`);
      } catch (e) {
        if (e instanceof ApiError && e.code === "ALREADY_BILLED" && e.details?.invoiceId) {
          toast("success", tr("مفوتر مسبقاً — تم فتح الفاتورة", "Already billed — opening the invoice"));
          router.push(`/invoices/${e.details.invoiceId}`);
        } else toast("error", e instanceof Error ? e.message : String(e));
      } finally { setPending(false); }
    }}>{tr("إصدار فاتورة", "Bill")}</Button>
  );
}
