"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession, useToast } from "@/components/providers";
import { Button, Field, Modal, Select } from "@/components/ui";
import { api } from "@/lib/client";
import { CATEGORY } from "./labels";

type Tpl = { id: string; category: string; name: string; body: string; isActive: boolean };

/** WhatsApp message to one or more clients (free text or a template). */
export default function SendMessage({ clientIds, open, onClose, onSent, defaultCategory = "CUSTOM" }: { clientIds: string[]; open: boolean; onClose: () => void; onSent?: () => void; defaultCategory?: string }) {
  const { tr } = useSession();
  const tpls = useResource<Tpl[]>(open ? "/api/messaging/templates" : null);
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const { pending, run } = useSubmit();
  // Each time the dialog opens, start from the caller's default type.
  useEffect(() => { if (open) { setCategory(defaultCategory); setTemplateId(""); } }, [open, defaultCategory]);
  const tpl = tpls.data?.find((t) => t.id === templateId);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title={clientIds.length > 1 ? tr(`رسالة واتساب إلى ${clientIds.length} عميل`, `WhatsApp to ${clientIds.length} clients`) : tr("إرسال رسالة واتساب", "Send WhatsApp message")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button>
        <Button loading={pending} disabled={!templateId && message.trim().length < 2} onClick={async () => {
          const r = await run(() => api<{ queued: number; skipped: number }>("/api/messaging/send", { method: "POST", body: { clientIds, category, templateId: templateId || null, message: templateId ? null : message } }));
          if (r) { onSent?.(); onClose(); setMessage(""); setTemplateId(""); toast(r.skipped ? "error" : "success", r.skipped ? tr(`أُرسلت ${r.queued} — تم تخطي ${r.skipped} (أوقفوا الرسائل التسويقية أو مكررة)`, `Sent ${r.queued}, skipped ${r.skipped} (opted out or duplicate)`) : tr(`تم إرسال ${r.queued} رسالة`, `${r.queued} message(s) sent`)); }
        }}>{tr("إرسال", "Send")}</Button></>}>
      <div className="space-y-3">
        <Field label={tr("القالب", "Template")}>
          <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); const t = tpls.data?.find((x) => x.id === e.target.value); if (t) setCategory(["PROMOTION", "REACTIVATION", "PAYMENT_REMINDER", "FOLLOW_UP", "SESSION_REMINDER", "SUBSCRIPTION_EXPIRY"].includes(t.category) ? t.category : "CUSTOM"); }}>
            <option value="">{tr("— نص حر —", "— free text —")}</option>
            {(tpls.data ?? []).filter((t) => t.isActive && t.category !== "CUSTOM").map((t) => <option key={t.id} value={t.id}>{tr(CATEGORY[t.category]?.[0] ?? t.category, CATEGORY[t.category]?.[1] ?? t.category)} — {t.name}</option>)}
          </Select>
        </Field>
        {tpl ? <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{tpl.body}</p> : (
          <Field label={tr("الرسالة", "Message")} hint={tr("يمكن استخدام {{client_name}} و {{clinic_name}}", "You can use {{client_name}} and {{clinic_name}}")}>
            <textarea rows={4} maxLength={1024} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        )}
        <Field label={tr("نوع الرسالة", "Message type")} hint={tr("الرسائل التسويقية لا تُرسل لمن طلب إيقافها.", "Marketing messages skip clients who opted out.")}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {["CUSTOM", "PROMOTION", "REACTIVATION", "FOLLOW_UP", "PAYMENT_REMINDER", "SESSION_REMINDER", "SUBSCRIPTION_EXPIRY"].map((c) => <option key={c} value={c}>{tr(CATEGORY[c][0], CATEGORY[c][1])}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

