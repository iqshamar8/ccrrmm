"use client";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { api, setPref } from "@/lib/client";
import { type Locale, makeTr } from "@/lib/i18n";

export default function LoginForm({ locale }: { locale: Locale }) {
  const tr = makeTr(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Set when the account has 2FA: the second step asks for a TOTP / recovery code.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (mfaToken) {
        await api("/api/auth/mfa/verify", { body: { mfaToken, code: code.trim() } });
        window.location.href = "/";
        return;
      }
      const res = await api<{ mfaToken?: string }>("/api/auth/login", { body: { email, password } });
      if (res?.mfaToken) {
        setMfaToken(res.mfaToken);
        setPending(false);
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden lg:flex flex-col justify-between bg-brand p-12 text-white">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-lg bg-white/15">M</span> MedCRM
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-snug">
            {tr("منصة متكاملة لإدارة العيادات والمراكز الطبية والتجميلية", "One platform to run medical & aesthetic clinics")}
          </h1>
          <p className="mt-4 max-w-md text-white/80">
            {tr("العملاء، المواعيد، الملفات الطبية، المالية، المخازن والموارد البشرية — لكل مؤسسة بيئة معزولة وآمنة.",
              "Clients, appointments, medical records, finance, inventory and HR — every organization in its own isolated, secure space.")}
          </p>
        </div>
        <p className="text-sm text-white/60">© {new Date().getFullYear()} MedCRM</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-2xl font-semibold">{tr("تسجيل الدخول", "Sign in")}</h2>
            <button type="button" className="text-sm text-muted hover:text-ink"
              onClick={() => { setPref("locale", locale === "ar" ? "en" : "ar"); window.location.reload(); }}>
              {locale === "ar" ? "English" : "العربية"}
            </button>
          </div>
          <div className="space-y-4">
            {mfaToken ? (
              <>
                <p className="text-sm text-muted">
                  {tr("أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.",
                    "Enter the 6-digit code from your authenticator app, or one of your recovery codes.")}
                </p>
                <Field label={tr("رمز التحقق", "Verification code")}>
                  <Input autoFocus autoComplete="one-time-code" inputMode="text" required dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
                </Field>
                <button type="button" className="text-sm text-muted hover:text-ink"
                  onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>
                  {tr("رجوع", "Back")}
                </button>
              </>
            ) : (
              <>
                <Field label={tr("البريد الإلكتروني", "Email")}>
                  <Input type="email" autoComplete="username" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <Field label={tr("كلمة المرور", "Password")}>
                  <Input type="password" autoComplete="current-password" required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
              </>
            )}
            {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full" loading={pending}>{mfaToken ? tr("تحقق", "Verify") : tr("دخول", "Sign in")}</Button>
          </div>
          <p className="mt-6 text-xs text-muted">
            {tr("حسابات تجريبية: راجع docs/DEMO_ACCOUNTS.md", "Demo accounts: see docs/DEMO_ACCOUNTS.md")}
          </p>
        </form>
      </section>
    </main>
  );
}
