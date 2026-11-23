"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { type Locale, makeTr } from "@/lib/i18n";
import { Effects, LangToggle } from "../welcome/Effects";
import { ClientFile } from "../welcome/fragments";
import "../welcome/landing.css";

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
    <div className="lp lg" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      <Effects />
      <div className="lp-lights" aria-hidden="true">
        <div className="lp-beam" />
        <div className="lp-light lp-light--a" />
        <div className="lp-light lp-light--b" />
        <div className="lp-light lp-light--c" />
        <div className="lp-spot" />
        <div className="lp-grain" />
      </div>

      <header className="lp-nav lp-wrap">
        <div className="lp-nav__bar">
          <Link href="/" className="lp-brand" aria-label={tr("MedCRM، الصفحة الرئيسية", "MedCRM, home")}>
            <span className="lp-brand__mark" aria-hidden="true">M</span>MedCRM
          </Link>
          <div className="lp-nav__end">
            <LangToggle locale={locale} />
          </div>
        </div>
      </header>

      <main className="lg__main lp-wrap">
        <div className="lg__grid">
          <section className="lg__pitch lp-rise lp-rise--1">
            <p className="lg__statement">{tr("عيادتك كلها في شاشة واحدة", "Your whole clinic, one screen")}</p>
            <p>{tr("المواعيد والملفات الطبية والفواتير والمخزون والتذكيرات، كل مؤسسة في بيئة معزولة وآمنة.",
              "Appointments, medical records, invoices, stock and reminders, every organisation in its own isolated, secure space.")}</p>
            <figure className="lp-shot lg__shot" data-ui><ClientFile tr={tr} /></figure>
          </section>

          <form onSubmit={submit} className="lg__card lp-rise lp-rise--2" aria-labelledby="login-title">
            <h1 id="login-title">{mfaToken ? tr("رمز التحقق", "Verification code") : tr("الدخول إلى MedCRM", "Sign in to MedCRM")}</h1>
            <p className="lg__hint">
              {mfaToken
                ? tr("أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.", "Enter the 6-digit code from your authenticator app, or one of your recovery codes.")
                : tr("أهلاً بعودتك. ادخل بحساب مؤسستك.", "Welcome back. Sign in with your organisation account.")}
            </p>

            <div className="lg__fields">
              {mfaToken ? (
                <>
                  <label className="lg__field" htmlFor="lg-code">{tr("رمز التحقق", "Verification code")}
                    <input id="lg-code" autoFocus autoComplete="one-time-code" inputMode="text" required dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
                  </label>
                  <button type="button" className="lg__link" onClick={() => { setMfaToken(null); setCode(""); setError(null); }}>
                    {tr("رجوع", "Back")}
                  </button>
                </>
              ) : (
                <>
                  <label className="lg__field" htmlFor="lg-email">{tr("البريد الإلكتروني", "Email")}
                    <input id="lg-email" type="email" autoComplete="username" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label className="lg__field" htmlFor="lg-password">{tr("كلمة المرور", "Password")}
                    <input id="lg-password" type="password" autoComplete="current-password" required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </label>
                </>
              )}
              {error && <p role="alert" className="lg__err">{error}</p>}
              <button type="submit" className="lp-btn lp-btn--lime lg__submit" disabled={pending}>
                {pending && <span className="lg__spin" aria-hidden="true" />}
                {mfaToken ? tr("تحقق", "Verify") : tr("دخول", "Sign in")}
              </button>
            </div>
            <p className="lg__demo">{tr("حسابات تجريبية: راجع docs/DEMO_ACCOUNTS.md", "Demo accounts: see docs/DEMO_ACCOUNTS.md")}</p>
          </form>
        </div>
      </main>

      <footer className="lp-wrap lp-foot">
        <span>© {new Date().getFullYear()} MedCRM</span>
        <nav aria-label={tr("روابط", "Links")}><Link href="/">{tr("الصفحة الرئيسية", "Home")}</Link><Link href="/#pricing">{tr("الأسعار", "Pricing")}</Link></nav>
      </footer>
    </div>
  );
}
