"use client";
import { useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, Field, Input, Modal } from "@/components/ui";
import { api } from "@/lib/client";

type Overview = {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesLeft: number;
  lastLoginAt: string | null;
  events: { action: string; ip: string | null; userAgent: string | null; createdAt: string }[];
};

/** Two-factor (TOTP) enrolment / removal, "sign out everywhere", and recent security events. */
export default function SecurityCard() {
  const { tr, locale } = useSession();
  const { data, reload } = useResource<Overview>("/api/auth/security");
  const { pending, fields, run } = useSubmit();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);

  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(locale === "ar" ? "ar" : "en-GB") : "—");

  async function startSetup() {
    const r = await run(() => api<{ secret: string; uri: string }>("/api/auth/mfa/setup", { method: "POST", body: {} }));
    if (r) { setSetup(r); setCode(""); }
  }
  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(
      () => api<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { method: "POST", body: { code: code.trim() } }),
      tr("تم تفعيل التحقق بخطوتين", "Two-factor authentication enabled"),
    );
    if (r) { setSetup(null); setCodes(r.recoveryCodes); reload(); }
  }
  async function disable(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(
      () => api("/api/auth/mfa/disable", { method: "POST", body: { password } }),
      tr("تم إيقاف التحقق بخطوتين", "Two-factor authentication turned off"),
    );
    if (r) { setDisableOpen(false); setPassword(""); reload(); }
  }
  async function revoke() {
    const r = await run(
      () => api("/api/auth/sessions/revoke", { method: "POST", body: {} }),
      tr("تم تسجيل الخروج من جميع الأجهزة الأخرى", "Signed out of all other devices"),
    );
    if (r) { setRevokeOpen(false); reload(); }
  }

  return (
    <Card className="mt-6 max-w-lg p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-medium">{tr("الأمان", "Security")}</p>
        {data && (data.mfaEnabled
          ? <Badge tone="green">{tr("التحقق بخطوتين مفعّل", "2FA on")}</Badge>
          : <Badge>{tr("التحقق بخطوتين غير مفعّل", "2FA off")}</Badge>)}
      </div>

      {data && (
        <div className="space-y-4 text-sm">
          {data.mfaEnabled ? (
            <div className="space-y-2">
              <p className="text-muted">
                {tr("مفعّل منذ", "Enabled since")} {fmt(data.mfaEnabledAt)} · {tr("رموز استرداد متبقية:", "Recovery codes left:")} {data.recoveryCodesLeft}
              </p>
              <Button variant="secondary" onClick={() => setDisableOpen(true)}>{tr("إيقاف التحقق بخطوتين", "Turn off 2FA")}</Button>
            </div>
          ) : setup ? (
            <form onSubmit={confirmSetup} className="space-y-3">
              <p className="text-muted">
                {tr(
                  "أضف الحساب في تطبيق المصادقة (Google Authenticator أو Microsoft Authenticator…) بإدخال المفتاح التالي يدوياً، ثم اكتب الرمز الظاهر.",
                  "Add the account in your authenticator app (Google Authenticator, Microsoft Authenticator…) by entering this key manually, then type the code it shows.",
                )}
              </p>
              <code dir="ltr" className="block select-all break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm">{setup.secret}</code>
              <a dir="ltr" href={setup.uri} className="block break-all text-xs text-brand underline">{tr("فتح في تطبيق المصادقة", "Open in authenticator app")}</a>
              <Field label={tr("رمز التحقق", "Verification code")} error={fields.code}>
                <Input autoFocus dir="ltr" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" loading={pending}>{tr("تفعيل", "Enable")}</Button>
                <Button type="button" variant="ghost" onClick={() => setSetup(null)}>{tr("إلغاء", "Cancel")}</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-muted">{tr("طبقة حماية إضافية: رمز من تطبيق المصادقة عند كل تسجيل دخول.", "An extra layer of protection: a code from your authenticator app at every sign-in.")}</p>
              <Button onClick={startSetup} loading={pending}>{tr("تفعيل التحقق بخطوتين", "Set up 2FA")}</Button>
            </div>
          )}

          <div className="border-t border-line pt-4">
            <p className="mb-2 text-muted">{tr("آخر تسجيل دخول:", "Last sign-in:")} {fmt(data.lastLoginAt)}</p>
            <Button variant="secondary" onClick={() => setRevokeOpen(true)}>{tr("تسجيل الخروج من جميع الأجهزة الأخرى", "Sign out all other devices")}</Button>
          </div>

          {data.events.length > 0 && (
            <div className="border-t border-line pt-4">
              <p className="mb-2 font-medium">{tr("النشاط الأمني الأخير", "Recent security activity")}</p>
              <ul className="space-y-1">
                {data.events.map((ev, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-3 text-xs" title={ev.userAgent ?? undefined}>
                    <span dir="ltr" className="font-mono">{ev.action}</span>
                    <span dir="ltr" className="text-muted">{ev.ip ? `${ev.ip} · ` : ""}{fmt(ev.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Recovery codes are shown exactly once, right after enabling. */}
      <Modal open={!!codes} onClose={() => setCodes(null)} title={tr("رموز الاسترداد", "Recovery codes")}
        footer={<Button onClick={() => setCodes(null)}>{tr("حفظتها", "I have saved them")}</Button>}>
        <p className="mb-3 text-sm text-muted">
          {tr(
            "احفظ هذه الرموز في مكان آمن. كل رمز يُستخدم مرة واحدة إذا فقدت هاتفك، ولن تظهر مرة أخرى.",
            "Store these somewhere safe. Each one works once if you lose your phone, and they will not be shown again.",
          )}
        </p>
        <div dir="ltr" className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes?.map((c) => <code key={c} className="select-all rounded bg-surface-2 px-2 py-1">{c}</code>)}
        </div>
      </Modal>

      <Modal open={disableOpen} onClose={() => setDisableOpen(false)} title={tr("إيقاف التحقق بخطوتين", "Turn off 2FA")}>
        <form onSubmit={disable} className="space-y-4">
          <Field label={tr("كلمة المرور الحالية", "Current password")} error={fields.password}>
            <Input type="password" dir="ltr" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" variant="danger" loading={pending}>{tr("إيقاف", "Turn off")}</Button>
        </form>
      </Modal>

      <ConfirmModal open={revokeOpen} onClose={() => setRevokeOpen(false)} onConfirm={revoke} loading={pending}
        title={tr("تسجيل الخروج من جميع الأجهزة الأخرى", "Sign out all other devices")}
        text={tr("ستنتهي الجلسات على كل الأجهزة الأخرى، وستبقى مسجلاً على هذا الجهاز.", "Sessions on every other device will end. You stay signed in on this one.")}
        confirmLabel={tr("تسجيل الخروج", "Sign out")} cancelLabel={tr("إلغاء", "Cancel")} />
    </Card>
  );
}
