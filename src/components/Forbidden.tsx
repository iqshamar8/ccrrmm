"use client";
import { Card, EmptyState } from "./ui";
import { useSession } from "./providers";

export default function Forbidden() {
  const { tr } = useSession();
  return (
    <Card>
      <EmptyState
        title={tr("لا تملك صلاحية الوصول لهذه الصفحة", "You don't have access to this page")}
        text={tr("تواصل مع مدير المؤسسة لمنحك الصلاحية المطلوبة.", "Ask your organization admin to grant you the required permission.")}
      />
    </Card>
  );
}
