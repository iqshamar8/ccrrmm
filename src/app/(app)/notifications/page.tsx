"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, StatCard, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { CATEGORY, PLACEHOLDERS, STATUS } from "@/components/messaging/labels";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Msg = { id: string; category: string; status: string; toPhone: string; body: string; error: string | null; scheduledFor: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; createdAt: string; client: { id: string; fullName: string; code: string } | null; campaign: { id: string; name: string } | null };
type Tpl = { id: string; category: string; name: string; language: string; body: string; waTemplateName: string | null; waLanguage: string | null; isDefault: boolean; isActive: boolean };
type Rules = Record<string, Record<string, number | boolean>>;
type Settings = { provider: "DISABLED" | "SANDBOX" | "WHATSAPP_CLOUD"; phoneNumberId: string | null; wabaId: string | null; defaultCountryCode: string; quietStartHour: number; quietEndHour: number; rules: Rules; accessToken: string | null; hasAppSecret: boolean; verifyToken: string | null; webhookPath: string };
type Tab = "log" | "templates" | "settings";

export default function MessagingPage() {
  const { tr, can } = useSession();
  const [tab, setTab] = useState<Tab>("log");
  useEffect(() => { const st = new URLSearchParams(window.location.search).get("tab"); if (st === "templates" || st === "settings") setTab(st); }, []);
  const { pending, run } = useSubmit();
  const [bump, setBump] = useState(0);
  if (!can("notifications.view")) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("الرسائل وواتساب", "Messages & WhatsApp")} subtitle={tr("مركز موحد لرسائل العملاء: تأكيد الحجوزات، التذكيرات، المدفوعات، الاشتراكات، المتابعة، أعياد الميلاد والعروض — مع تتبع حالة كل رسالة.", "One centre for client messages — confirmations, reminders, payments, subscriptions, follow-ups, birthdays and offers — with delivery tracking.")}
        actions={can("notifications.update") && <Button variant="secondary" loading={pending} onClick={async () => { if (await run(() => api("/api/messaging/run", { method: "POST", body: {} }), tr("تم تشغيل التذكيرات والإرسال", "Automations ran and queue was sent"))) setBump((b) => b + 1); }}>{tr("تشغيل التذكيرات الآن", "Run automations now")}</Button>} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {([["log", tr("سجل الرسائل", "Message log")], ["templates", tr("القوالب", "Templates")], ["settings", tr("الأتمتة والربط", "Automations & connection")]] as [Tab, string][]).map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>)}
      </div>
      {tab === "log" && <Log key={bump} />}
      {tab === "templates" && <Templates />}
      {tab === "settings" && <SettingsTab />}
    </>
  );
}

function Log() {
  const { tr, can, locale } = useSession();
  const [f, setF] = useState({ status: "", category: "", q: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  useEffect(() => { const st = new URLSearchParams(window.location.search).get("status"); if (st) setF((x) => ({ ...x, status: st })); }, []);
  const { data, loading, reload } = useResource<{ items: Msg[]; total: number; byStatus: Record<string, number> }>(`/api/messaging/messages?${new URLSearchParams({ ...f, page: String(page) })}`);
  const [open, setOpen] = useState<Msg | null>(null);
  const { pending, run } = useSubmit();
  const bs = data?.byStatus ?? {};
  const delivered = (bs.DELIVERED ?? 0) + (bs.READ ?? 0), attempted = delivered + (bs.SENT ?? 0) + (bs.FAILED ?? 0);
  const act = async (m: Msg, action: "CANCEL" | "RETRY") => { if (await run(() => api(`/api/messaging/messages/${m.id}`, { method: "POST", body: { action } }), tr("تم", "Done"))) { setOpen(null); reload(); } };
  const pages = Math.ceil((data?.total ?? 0) / 50);
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard label={tr("بالانتظار", "Queued")} value={(bs.QUEUED ?? 0) + (bs.SENDING ?? 0)} />
        <StatCard label={tr("وصلت", "Delivered")} value={delivered} hint={attempted ? `${Math.round((delivered / attempted) * 100)}% ${tr("نسبة الاستلام", "delivery rate")}` : undefined} />
        <StatCard label={tr("قُرئت", "Read")} value={bs.READ ?? 0} hint={delivered ? `${Math.round(((bs.READ ?? 0) / delivered) * 100)}% ${tr("من المستلمة", "of delivered")}` : undefined} />
        <StatCard label={tr("فشلت", "Failed")} value={<span className={bs.FAILED ? "text-danger" : ""}>{bs.FAILED ?? 0}</span>} />
      </div>
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالاسم أو الرقم…", "Search name or number…")} value={f.q} onChange={(e) => { setPage(1); setF({ ...f, q: e.target.value }); }} />
          <Select className="max-w-[11rem]" value={f.status} onChange={(e) => { setPage(1); setF({ ...f, status: e.target.value }); }}><option value="">{tr("كل الحالات", "All statuses")}</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}</Select>
          <Select className="max-w-[13rem]" value={f.category} onChange={(e) => { setPage(1); setF({ ...f, category: e.target.value }); }}><option value="">{tr("كل الأنواع", "All types")}</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}</Select>
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input type="date" dir="ltr" className="max-w-[10rem]" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <Table head={[tr("الوقت", "Time"), tr("العميل", "Client"), tr("النوع", "Type"), tr("الرسالة", "Message"), tr("الحالة", "Status")]}>
          {loading && !data ? <LoadingRows cols={5} /> : (data?.items ?? []).map((m) => {
            const s = STATUS[m.status];
            return (
              <Tr key={m.id} onClick={() => setOpen(m)}>
                <Td className="whitespace-nowrap text-xs text-muted">{fmtDate(m.status === "QUEUED" ? m.scheduledFor : m.sentAt ?? m.createdAt, locale, true)}</Td>
                <Td>{m.client?.fullName ?? "—"}<div className="text-xs text-muted" dir="ltr">+{m.toPhone}</div></Td>
                <Td className="text-xs">{tr(CATEGORY[m.category][0], CATEGORY[m.category][1])}{m.campaign && <div className="text-muted">{m.campaign.name}</div>}</Td>
                <Td className="max-w-md"><p className="line-clamp-2 text-sm">{m.body}</p>{m.error && <p className="text-xs text-danger">{m.error}</p>}</Td>
                <Td><Badge tone={s[2]}>{tr(s[0], s[1])}</Badge></Td>
              </Tr>
            );
          })}
        </Table>
        {!loading && !data?.items.length && <EmptyState title={tr("لا توجد رسائل", "No messages")} />}
        {pages > 1 && <div className="flex items-center justify-end gap-2 border-t border-line p-3 text-sm"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>{tr("السابق", "Prev")}</Button><span className="tabular">{page} / {pages}</span><Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>{tr("التالي", "Next")}</Button></div>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${tr(CATEGORY[open.category][0], CATEGORY[open.category][1])} → +${open.toPhone}` : ""}
        footer={open && can("notifications.update") && <>
          {open.status === "QUEUED" && <Button variant="secondary" loading={pending} onClick={() => act(open, "CANCEL")}>{tr("إلغاء الإرسال", "Cancel send")}</Button>}
          {["FAILED", "CANCELLED"].includes(open.status) && <Button loading={pending} onClick={() => act(open, "RETRY")}>{tr("إعادة المحاولة", "Retry")}</Button>}
        </>}>
        {open && <div className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3">{open.body}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([["مجدولة", "Scheduled", open.scheduledFor], ["أُرسلت", "Sent", open.sentAt], ["وصلت", "Delivered", open.deliveredAt], ["قُرئت", "Read", open.readAt]] as [string, string, string | null][]).map(([a, e, v]) => <div key={e}><span className="text-muted">{tr(a, e)}: </span>{v ? fmtDate(v, locale, true) : "—"}</div>)}
          </div>
          {open.error && <p className="rounded-lg bg-red-500/10 p-2 text-xs text-danger" dir="ltr">{open.error}</p>}
        </div>}
      </Modal>
    </>
  );
}

function Templates() {
  const { tr, can } = useSession();
  const { data, loading, reload } = useResource<Tpl[]>("/api/messaging/templates");
  const [edit, setEdit] = useState<Tpl | "new" | null>(null);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <p className="text-xs text-muted">{tr("الرسائل التي يبدؤها النشاط التجاري على واتساب تتطلب قالباً معتمداً من Meta. اكتب اسم القالب المعتمد ليُرسل به، وتُمرَّر المتغيرات بالترتيب {{1}}، {{2}}…", "Business-initiated WhatsApp messages need a Meta-approved template. Enter the approved name; placeholders are passed in order as {{1}}, {{2}}…")}</p>
        {can("notifications.create") && <Button size="sm" onClick={() => setEdit("new")}>+ {tr("قالب", "Template")}</Button>}
      </div>
      <Table head={[tr("النوع", "Type"), tr("الاسم", "Name"), tr("النص", "Text"), tr("قالب واتساب المعتمد", "Approved WA template"), tr("الحالة", "Status")]}>
        {loading && !data ? <LoadingRows cols={5} /> : (data ?? []).map((t) => (
          <Tr key={t.id} onClick={can("notifications.update") ? () => setEdit(t) : undefined}>
            <Td className="text-xs">{tr(CATEGORY[t.category][0], CATEGORY[t.category][1])}{t.isDefault && <div><Badge>{tr("افتراضي", "Default")}</Badge></div>}</Td>
            <Td className="font-medium">{t.name}</Td>
            <Td className="max-w-md"><p className="line-clamp-2 text-sm text-muted">{t.body}</p></Td>
            <Td dir="ltr" className="font-mono text-xs">{t.waTemplateName ? `${t.waTemplateName} (${t.waLanguage ?? t.language})` : <span className="text-muted">— {tr("نص فقط", "text only")}</span>}</Td>
            <Td><Badge tone={t.isActive ? "green" : "gray"}>{t.isActive ? tr("فعّال", "Active") : tr("معطل", "Off")}</Badge></Td>
          </Tr>
        ))}
      </Table>
      <TemplateModal t={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Card>
  );
}

function TemplateModal({ t, onClose, onSaved }: { t: Tpl | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const isNew = t === "new";
  const blank = { category: "CUSTOM", name: "", language: "ar", body: "", waTemplateName: "", waLanguage: "", isActive: true };
  const [f, setF] = useState(blank);
  const [for_, setFor] = useState<string | null>(null);
  const key = t === "new" ? "new" : t?.id ?? null;
  if (key !== for_) { setFor(key); setF(t && t !== "new" ? { category: t.category, name: t.name, language: t.language, body: t.body, waTemplateName: t.waTemplateName ?? "", waLanguage: t.waLanguage ?? "", isActive: t.isActive } : blank); }
  const [preview, setPreview] = useState<string | null>(null);
  const { pending, fields, run } = useSubmit();
  useEffect(() => {
    if (!t || f.body.length < 2) { setPreview(null); return; }
    const h = setTimeout(async () => { try { setPreview((await api<{ text: string }>("/api/messaging/templates/preview", { method: "POST", body: { body: f.body } })).text); } catch { setPreview(null); } }, 400);
    return () => clearTimeout(h);
  }, [f.body, t]);
  const insert = (k: string) => setF((x) => ({ ...x, body: `${x.body}{{${k}}}` }));
  return (
    <Modal open={!!t} onClose={onClose} wide title={isNew ? tr("قالب جديد", "New template") : tr("تعديل القالب", "Edit template")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="tpl" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="tpl" className="grid gap-3 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api(isNew ? "/api/messaging/templates" : `/api/messaging/templates/${(t as Tpl).id}`, { method: isNew ? "POST" : "PATCH", body: f }), tr("تم الحفظ", "Saved"))) onSaved(); }}>
        <Field label={tr("النوع", "Type")}><Select disabled={!isNew && (t as Tpl).isDefault} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{tr(v[0], v[1])}</option>)}</Select></Field>
        <Field label={tr("الاسم", "Name")} error={fields.name}><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={tr("اللغة", "Language")}><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="ar">العربية</option><option value="en">English</option><option value="ku">کوردی</option></Select></Field>
        <Field label={tr("نص الرسالة", "Message text")} className="sm:col-span-3" error={fields.body}>
          <textarea required rows={4} maxLength={1024} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-1 sm:col-span-3">{PLACEHOLDERS.map(([k, ar, en]) => <button type="button" key={k} onClick={() => insert(k)} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs hover:bg-brand/10">{tr(ar, en)}</button>)}</div>
        {preview && <div className="sm:col-span-3"><p className="mb-1 text-xs text-muted">{tr("معاينة", "Preview")}</p><p className="whitespace-pre-wrap rounded-2xl rounded-ss-sm bg-emerald-500/10 p-3 text-sm">{preview}</p></div>}
        <Field label={tr("اسم القالب المعتمد في واتساب", "Approved WhatsApp template name")} hint={tr("اتركه فارغاً لإرسال نص عادي (يعمل فقط خلال 24 ساعة من آخر رسالة للعميل).", "Leave empty to send plain text (only works within 24h of the client's last message).")} error={fields.waTemplateName}>
          <Input dir="ltr" value={f.waTemplateName} onChange={(e) => setF({ ...f, waTemplateName: e.target.value })} placeholder="appointment_reminder_ar" />
        </Field>
        <Field label={tr("لغة القالب في واتساب", "WA template language")}><Input dir="ltr" value={f.waLanguage} onChange={(e) => setF({ ...f, waLanguage: e.target.value })} placeholder="ar" /></Field>
        <Checkbox label={tr("فعّال", "Active")} checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
      </form>
    </Modal>
  );
}

const RULE_FIELDS: { key: string; ar: string; en: string; nums: [string, string, string, number, number][] }[] = [
  { key: "APPOINTMENT_CONFIRM", ar: "تأكيد الحجز فور إنشائه", en: "Confirm bookings immediately", nums: [] },
  { key: "APPOINTMENT_REMINDER", ar: "تذكير بالموعد", en: "Appointment reminder", nums: [["hoursBefore", "قبل الموعد بـ (ساعة)", "Hours before", 1, 168]] },
  { key: "PAYMENT_REMINDER", ar: "تذكير بالمدفوعات المتأخرة", en: "Overdue payment reminder", nums: [["daysAfterDue", "بعد الاستحقاق بـ (يوم)", "Days after due", 0, 365], ["repeatDays", "يتكرر كل (يوم)", "Repeat every (days)", 1, 90]] },
  { key: "SUBSCRIPTION_EXPIRY", ar: "تذكير بانتهاء الاشتراك", en: "Subscription expiry", nums: [["daysBefore", "قبل الانتهاء بـ (يوم)", "Days before", 1, 90]] },
  { key: "SESSION_REMINDER", ar: "تذكير بالجلسات المتبقية", en: "Remaining sessions reminder", nums: [["daysIdle", "بعد انقطاع (يوم)", "After idle (days)", 3, 365]] },
  { key: "FOLLOW_UP", ar: "رسالة متابعة بعد الخدمة", en: "Post-visit follow-up", nums: [["hoursAfter", "بعد الزيارة بـ (ساعة)", "Hours after", 1, 336]] },
  { key: "BIRTHDAY", ar: "تهنئة عيد الميلاد", en: "Birthday greeting", nums: [["hour", "الساعة (محلياً)", "Local hour", 0, 23]] },
];

function SettingsTab() {
  const { tr, can } = useSession();
  const { data, reload } = useResource<Settings>("/api/messaging/settings");
  const [f, setF] = useState<(Settings & { accessTokenNew: string; appSecretNew: string }) | null>(null);
  useEffect(() => { if (data) setF({ ...data, accessTokenNew: "", appSecretNew: "" }); }, [data]);
  const { pending, fields, run } = useSubmit();
  if (!f) return <Card><LoadingRows cols={3} /></Card>;
  const edit = can("notifications.update");
  const setRule = (k: string, patch: Record<string, number | boolean>) => setF({ ...f, rules: { ...f.rules, [k]: { ...f.rules[k], ...patch } } });
  const hook = typeof window !== "undefined" ? `${window.location.origin}${f.webhookPath}` : f.webhookPath;
  const save = (extra: Record<string, unknown> = {}) => run(() => api("/api/messaging/settings", { method: "PUT", body: {
    provider: f.provider, phoneNumberId: f.phoneNumberId, wabaId: f.wabaId, defaultCountryCode: f.defaultCountryCode, quietStartHour: f.quietStartHour, quietEndHour: f.quietEndHour, rules: f.rules,
    accessToken: f.accessTokenNew || null, appSecret: f.appSecretNew || null, ...extra } }), tr("تم حفظ الإعدادات", "Settings saved"));
  return (
    <form className="grid gap-4 lg:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await save()) reload(); }}>
      <Card className="space-y-3 p-4">
        <p className="font-medium">{tr("الرسائل التلقائية", "Automatic messages")}</p>
        {RULE_FIELDS.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-2">
            <Checkbox disabled={!edit} label={tr(r.ar, r.en)} checked={!!f.rules[r.key]?.enabled} onChange={(e) => setRule(r.key, { enabled: e.target.checked })} />
            {r.nums.map(([k, ar, en, min, max]) => (
              <label key={k} className="flex items-center gap-1 text-xs text-muted">{tr(ar, en)}
                <Input disabled={!edit || !f.rules[r.key]?.enabled} type="number" min={min} max={max} dir="ltr" className="w-20" value={String(f.rules[r.key]?.[k] ?? "")} onChange={(e) => setRule(r.key, { [k]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tr("ساعات الهدوء (لا إرسال تلقائي): من", "Quiet hours (no automatic sends): from")}
          <Input disabled={!edit} type="number" min={0} max={23} dir="ltr" className="w-20" value={f.quietStartHour} onChange={(e) => setF({ ...f, quietStartHour: Number(e.target.value) })} />
          {tr("إلى", "to")}
          <Input disabled={!edit} type="number" min={0} max={23} dir="ltr" className="w-20" value={f.quietEndHour} onChange={(e) => setF({ ...f, quietEndHour: Number(e.target.value) })} />
        </div>
        <p className="text-xs text-muted">{tr("تأكيدات الحجز والرسائل اليدوية تُرسل حتى في ساعات الهدوء. لا تُرسل الرسائل التسويقية لمن طلب إيقافها (أو أرسل STOP).", "Booking confirmations and manual messages ignore quiet hours. Marketing messages never go to clients who opted out (or replied STOP).")}</p>
      </Card>
      <Card className="space-y-3 p-4">
        <p className="font-medium">{tr("ربط واتساب للأعمال (WhatsApp Business Cloud API)", "WhatsApp Business Cloud API connection")}</p>
        <Field label={tr("وضع الإرسال", "Sending mode")}>
          <Select disabled={!edit} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as Settings["provider"] })}>
            <option value="SANDBOX">{tr("تجريبي — محاكاة بدون إرسال فعلي", "Sandbox — simulated, nothing is sent")}</option>
            <option value="WHATSAPP_CLOUD">{tr("واتساب Cloud API (رسمي)", "WhatsApp Cloud API (official)")}</option>
            <option value="DISABLED">{tr("متوقف", "Off")}</option>
          </Select>
        </Field>
        {f.provider === "SANDBOX" && <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{tr("الوضع التجريبي: تظهر الرسائل في السجل كـ«وصلت» دون أن تصل للعملاء فعلاً.", "Sandbox: messages show as delivered in the log but never reach clients.")}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone number ID" error={fields.phoneNumberId}><Input disabled={!edit} dir="ltr" value={f.phoneNumberId ?? ""} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} /></Field>
          <Field label="WhatsApp Business Account ID"><Input disabled={!edit} dir="ltr" value={f.wabaId ?? ""} onChange={(e) => setF({ ...f, wabaId: e.target.value })} /></Field>
          <Field label={tr("رمز الوصول الدائم", "Permanent access token")} hint={f.accessToken ? tr(`محفوظ ${f.accessToken} — اتركه فارغاً للإبقاء`, `Saved ${f.accessToken} — leave empty to keep`) : undefined}>
            <Input disabled={!edit} type="password" autoComplete="off" dir="ltr" value={f.accessTokenNew} onChange={(e) => setF({ ...f, accessTokenNew: e.target.value })} />
          </Field>
          <Field label="App secret" hint={f.hasAppSecret ? tr("محفوظ — اتركه فارغاً للإبقاء", "Saved — leave empty to keep") : tr("مطلوب للتحقق من توقيع الإشعارات", "Needed to verify webhook signatures")}>
            <Input disabled={!edit} type="password" autoComplete="off" dir="ltr" value={f.appSecretNew} onChange={(e) => setF({ ...f, appSecretNew: e.target.value })} />
          </Field>
          <Field label={tr("رمز الدولة الافتراضي", "Default country code")}><Input disabled={!edit} dir="ltr" value={f.defaultCountryCode} onChange={(e) => setF({ ...f, defaultCountryCode: e.target.value })} /></Field>
        </div>
        {f.verifyToken && <div className="space-y-1 rounded-lg bg-surface-2 p-3 text-xs">
          <p className="font-medium">{tr("إعداد Webhook في تطبيق Meta", "Webhook settings in your Meta app")}</p>
          <p>Callback URL: <code dir="ltr" className="break-all">{hook}</code></p>
          <p>Verify token: <code dir="ltr">{f.verifyToken}</code></p>
          <p className="text-muted">{tr("اشترك في حقل messages لتحديث حالات الإرسال (وصلت/قُرئت/فشلت) واستقبال ردود العملاء.", "Subscribe to the messages field to receive delivery statuses and client replies.")}</p>
          {edit && <button type="button" className="text-brand hover:underline" onClick={async () => { if (await save({ regenerateVerifyToken: true })) reload(); }}>{tr("توليد رمز جديد", "Regenerate token")}</button>}
        </div>}
      </Card>
      {edit && <div className="lg:col-span-2"><Button type="submit" loading={pending}>{tr("حفظ الإعدادات", "Save settings")}</Button></div>}
    </form>
  );
}
