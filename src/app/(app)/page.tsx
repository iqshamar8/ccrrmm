"use client";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import TenantDashboard from "@/components/TenantDashboard";
import { fmtDate, fmtMoney } from "@/lib/i18n";
import { actionLabel } from "@/lib/labels";

type AuditRow = { id: string; action: string; userEmail: string | null; createdAt: string; tenant?: { name: string } | null };

export default function DashboardPage() {
  const s = useSession();
  if (s.user.isPlatformAdmin) return <PlatformDashboard />;
  if (!s.can("dashboard.view")) return <Forbidden />;
  return <TenantDashboard />;
}

function Activity({ rows, showTenant }: { rows: AuditRow[]; showTenant?: boolean }) {
  const { tr, locale } = useSession();
  return (
    <Card>
      <div className="border-b border-line px-4 py-3 font-medium">{tr("آخر النشاطات", "Recent activity")}</div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">{tr("لا توجد نشاطات بعد", "No activity yet")}</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm first:border-t-0">
              <div className="min-w-0">
                <p className="truncate">{actionLabel(r.action, locale)}{showTenant && r.tenant ? ` — ${r.tenant.name}` : ""}</p>
                <p className="truncate text-xs text-muted" dir="ltr">{r.userEmail ?? "system"}</p>
              </div>
              <span className="shrink-0 text-xs text-muted">{fmtDate(r.createdAt, locale, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PlatformDashboard() {
  const { tr, locale } = useSession();
  const { data, loading } = useResource<{
    tenants: number; status: Record<string, number>; users: number; branches: number; mrr: number;
    activeSubscriptions: number; expiringSoon: number; recent: AuditRow[];
  }>("/api/platform/stats");
  if (loading || !data) return <div className="grid place-items-center py-24"><Spinner /></div>;
  return (
    <>
      <PageHeader title={tr("لوحة المنصة", "Platform overview")} subtitle={tr("نظرة عامة على جميع المؤسسات المشتركة", "All subscribed organizations at a glance")} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={tr("المؤسسات", "Organizations")} value={data.tenants}
          hint={`${data.status.ACTIVE ?? 0} ${tr("نشطة", "active")} · ${data.status.TRIAL ?? 0} ${tr("تجريبية", "trial")} · ${data.status.SUSPENDED ?? 0} ${tr("موقوفة", "suspended")}`} />
        <StatCard label={tr("الإيراد الشهري المتكرر", "Monthly recurring revenue")} value={fmtMoney(data.mrr, "USD", locale)} hint={`${data.activeSubscriptions} ${tr("اشتراك مدفوع", "paid subscriptions")}`} />
        <StatCard label={tr("المستخدمون", "Users")} value={data.users} hint={`${data.branches} ${tr("فرع", "branches")}`} />
        <StatCard label={tr("اشتراكات تنتهي خلال 14 يوم", "Renewals due in 14 days")} value={data.expiringSoon} />
      </div>
      <Activity rows={data.recent} showTenant />
    </>
  );
}

