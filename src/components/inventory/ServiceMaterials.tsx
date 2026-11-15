"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Button } from "@/components/ui";
import { api } from "@/lib/client";
import { LineEditor, type Line, toLines, useItems } from "./shared";

/** Bill of materials for a service: deducted from the branch store when a visit is completed. */
export default function ServiceMaterials({ serviceId }: { serviceId: string }) {
  const { tr, can } = useSession();
  const items = useItems();
  const { data, reload } = useResource<{ itemId: string; quantity: string }[]>(`/api/services/${serviceId}/materials`);
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const { pending, run } = useSubmit();
  useEffect(() => { if (data) { setLines(data.map((m) => ({ itemId: m.itemId, quantity: String(Number(m.quantity)) }))); setDirty(false); } }, [data]);
  const editable = can("services.update");
  return (
    <div className="sm:col-span-4 border-t border-line pt-4">
      <p className="mb-1 font-medium">{tr("المواد المستهلكة في الخدمة", "Materials used per session")}</p>
      <p className="mb-3 text-xs text-muted">{tr("تُخصم تلقائياً من مخزن الفرع عند إكمال الزيارة، وتُرحّل تكلفتها على تكلفة المواد.", "Deducted from the branch store automatically when the visit is completed, and costed to materials expense.")}</p>
      {editable ? <>
        <LineEditor lines={lines} onChange={(l) => { setLines(l); setDirty(true); }} items={items} />
        {dirty && <Button type="button" size="sm" className="mt-2" loading={pending} onClick={async () => {
          if (await run(() => api(`/api/services/${serviceId}/materials`, { method: "PUT", body: toLines(lines) }), tr("تم حفظ المواد", "Materials saved"))) reload();
        }}>{tr("حفظ المواد", "Save materials")}</Button>}
      </> : <ul className="text-sm">{lines.map((l) => <li key={l.itemId}>{items.find((i) => i.id === l.itemId)?.name} × {l.quantity}</li>)}</ul>}
    </div>
  );
}
