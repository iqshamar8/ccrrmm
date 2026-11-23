import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCtx } from "@/server/api";
import { isLocale } from "@/lib/i18n";
import { SessionProvider, ToastProvider, type SessionInfo } from "@/components/providers";
import Shell from "@/components/Shell";
import { HEX, inkOn } from "@/lib/branding";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const l = (await cookies()).get("locale")?.value;
  const locale = isLocale(l) ? l : ctx.user.locale === "en" ? "en" : "ar";

  const t = ctx.tenant;
  const session: SessionInfo = {
    locale,
    user: {
      id: ctx.user.id, email: ctx.user.email, fullName: ctx.user.fullName, isPlatformAdmin: ctx.user.isPlatformAdmin,
      roleName: ctx.user.roleName, roleKey: ctx.user.roleKey,
    },
    tenant: t && {
      id: t.id, name: t.name, slug: t.slug, type: t.type, primaryColor: t.primaryColor, accentColor: t.accentColor, logoUrl: t.logoUrl,
      baseCurrency: t.baseCurrency, access: t.access, plan: t.plan,
      subscription: t.subscription && {
        status: t.subscription.status,
        endsAt: t.subscription.endsAt?.toISOString() ?? null,
        trialEndsAt: t.subscription.trialEndsAt?.toISOString() ?? null,
      },
    },
    permissions: [...ctx.permissions],
    features: [...ctx.features],
  };

  return (
    <SessionProvider value={session}>
      <ToastProvider>
        {/* Tenant branding: the clinic's two colours drive --brand and --accent everywhere */}
        {t && <style>{`:root{${HEX.test(t.primaryColor) ? `--brand:${t.primaryColor};--brand-ink:${inkOn(t.primaryColor)};` : ""}${HEX.test(t.accentColor) ? `--accent:${t.accentColor};--accent-ink:${inkOn(t.accentColor)};` : ""}}`}</style>}
        <Shell>{children}</Shell>
      </ToastProvider>
    </SessionProvider>
  );
}
