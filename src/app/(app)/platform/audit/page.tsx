"use client";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Card, LoadingRows, PageHeader, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { fmtDate } from "@/lib/i18n";
import { actionLabel } from "@/lib/labels";

type Row = { id: string; action: string; entity: string; userEmail: string | null; ip: string | null; createdAt: string; tenant: { name: string } | null };

export default function PlatformAuditPage() {
  const s = useSession();
  const { tr, locale } = s;
  const { data, loading } = useResource<Row[]>(s.user.isPlatformAdmin ? "/api/platform/stats?audit=1&take=300" : null);
  if (!s.user.isPlatformAdmin) return <Forbidden />;
  return (
    <>
      <PageHeader title={tr("سجل نشاط المنصة", "Platform activity log")} subtitle={tr("آخر 300 عملية في جميع المؤسسات", "Latest 300 events across all organizations")} />
      <Card>
        <Table head={[tr("العملية", "Action"), tr("المؤسسة", "Organization"), tr("المستخدم", "User"), "IP", tr("الوقت", "Time")]}>
          {loading ? <LoadingRows cols={5} /> : data?.map((r) => (
            <Tr key={r.id}>
              <Td>{actionLabel(r.action, locale)} <span className="text-xs text-muted" dir="ltr">({r.action})</span></Td>
              <Td>{r.tenant?.name ?? tr("المنصة", "Platform")}</Td>
              <Td className="text-muted" ><span dir="ltr">{r.userEmail ?? "system"}</span></Td>
              <Td className="text-muted"><span dir="ltr">{r.ip ?? "—"}</span></Td>
              <Td className="text-muted whitespace-nowrap">{fmtDate(r.createdAt, locale, true)}</Td>
            </Tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
