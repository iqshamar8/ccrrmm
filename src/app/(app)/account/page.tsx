"use client";
import { useState } from "react";
import { useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { api } from "@/lib/client";
import SecurityCard from "./SecurityCard";

export default function AccountPage() {
  const s = useSession();
  const { tr } = s;
  const { pending, fields, run } = useSubmit();
  const [f, setF] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [mismatch, setMismatch] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.newPassword !== f.confirm) return setMismatch(true);
    setMismatch(false);
    const ok = await run(() => api("/api/auth/password", { body: { currentPassword: f.currentPassword, newPassword: f.newPassword } }),
      tr("تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى", "Password changed; other devices were signed out"));
    if (ok) setF({ currentPassword: "", newPassword: "", confirm: "" });
  }

  return (
    <>
      <PageHeader title={tr("حسابي", "My account")} subtitle={s.user.email} />
      <Card className="max-w-lg p-5">
        <p className="mb-4 font-medium">{tr("تغيير كلمة المرور", "Change password")}</p>
        <form onSubmit={submit} className="space-y-4">
          <Field label={tr("كلمة المرور الحالية", "Current password")} error={fields.currentPassword}>
            <Input type="password" dir="ltr" required autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
          </Field>
          <Field label={tr("كلمة المرور الجديدة", "New password")} error={fields.newPassword} hint={tr("8 أحرف على الأقل، حروف وأرقام", "8+ chars, letters & digits")}>
            <Input type="password" dir="ltr" required autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
          </Field>
          <Field label={tr("تأكيد كلمة المرور", "Confirm password")} error={mismatch ? tr("كلمتا المرور غير متطابقتين", "Passwords don't match") : undefined}>
            <Input type="password" dir="ltr" required autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          </Field>
          <Button type="submit" loading={pending}>{tr("حفظ", "Save")}</Button>
        </form>
      </Card>
      <SecurityCard />
    </>
  );
}
