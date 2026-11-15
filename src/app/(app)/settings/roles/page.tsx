"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, Spinner } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { ACTION_LABELS, ACTIONS, MODULES } from "@/lib/permissions";

type Role = { id: string; key: string; name: string; nameAr: string; description: string | null; isSystem: boolean; permissions: string[]; users: number };

export default function RolesPage() {
  const s = useSession();
  const { tr, locale, can } = s;
  const { data, loading, reload } = useResource<Role[]>(can("roles.view") ? "/api/roles" : null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  useEffect(() => { if (data && !selected) setSelected(data[0]?.id ?? null); }, [data, selected]);
  if (!can("roles.view")) return <Forbidden />;
  if (loading && !data) return <div className="grid place-items-center py-24"><Spinner /></div>;
  const role = selected === "new" ? null : data?.find((r) => r.id === selected) ?? null;

  return (
    <>
      <PageHeader title={tr("الأدوار والصلاحيات", "Roles & permissions")}
        subtitle={tr("تحكم بكل صلاحية بشكل منفصل لكل دور. الأقسام غير المشمولة في باقتك تظهر معطلة.", "Control each permission per role. Modules outside your plan are greyed out.")}
        actions={can("roles.create") && <Button onClick={() => setSelected("new")}>+ {tr("دور مخصص", "Custom role")}</Button>} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit p-2">
          {data?.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm ${selected === r.id ? "bg-brand/10 text-brand" : "hover:bg-surface-2"}`}>
              <span className="truncate">{locale === "ar" ? r.nameAr : r.name}</span>
              <span className="text-xs text-muted tabular">{r.users}</span>
            </button>
          ))}
        </Card>
        {(role || selected === "new") && <RoleEditor key={selected!} role={role} onSaved={(id) => { reload(); if (id) setSelected(id); }} onDeleted={() => { setSelected(null); reload(); }} />}
      </div>
    </>
  );
}

function RoleEditor({ role, onSaved, onDeleted }: { role: Role | null; onSaved: (id?: string) => void; onDeleted: () => void }) {
  const { tr, locale, can, features } = useSession();
  const isNew = !role;
  const locked = role?.key === "tenant_admin";
  const editable = isNew ? can("roles.create") : can("roles.update") && !locked;
  const [f, setF] = useState({ key: role?.key ?? "", name: role?.name ?? "", nameAr: role?.nameAr ?? "", description: role?.description ?? "" });
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? ["dashboard.view"]));
  const [confirmDel, setConfirmDel] = useState(false);
  const save = useSubmit();
  const del = useSubmit();
  const featureSet = useMemo(() => new Set(features), [features]);

  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const toggleModule = (keys: string[]) => setPerms((s) => {
    const n = new Set(s); const all = keys.every((k) => n.has(k));
    keys.forEach((k) => (all ? n.delete(k) : n.add(k))); return n;
  });

  async function submit() {
    const body = { ...f, permissions: [...perms] };
    const r = await save.run(() => api<{ id: string }>(isNew ? "/api/roles" : `/api/roles/${role!.id}`, { method: isNew ? "POST" : "PATCH", body }), tr("تم حفظ الدور", "Role saved"));
    if (r) onSaved(r.id);
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
        <div className="grid flex-1 gap-3 sm:grid-cols-3">
          <Field label={tr("الاسم بالعربية", "Arabic name")} error={save.fields.nameAr}><Input disabled={!editable} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
          <Field label={tr("الاسم بالإنجليزية", "English name")} error={save.fields.name}><Input disabled={!editable} dir="ltr" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={tr("المعرّف", "Key")} error={save.fields.key}><Input disabled={!isNew} dir="ltr" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="laser_tech" /></Field>
        </div>
        <div className="flex gap-2 pt-6">
          {role?.isSystem && <Badge tone="blue">{tr("دور النظام", "System role")}</Badge>}
          {!isNew && !role!.isSystem && can("roles.delete") && <Button variant="secondary" className="text-danger" onClick={() => setConfirmDel(true)}>{tr("حذف", "Delete")}</Button>}
          {editable && <Button onClick={submit} loading={save.pending}>{tr("حفظ", "Save")}</Button>}
        </div>
      </div>
      {locked && <p className="border-b border-line bg-surface-2 px-4 py-2 text-xs text-muted">{tr("دور مدير المؤسسة يملك جميع الصلاحيات دائماً ولا يمكن تقييده.", "The organization admin role always has every permission.")}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="px-4 py-3 text-start font-medium">{tr("القسم", "Module")}</th>
              {ACTIONS.map((a) => <th key={a} className="px-2 py-3 font-medium">{locale === "ar" ? ACTION_LABELS[a].ar : ACTION_LABELS[a].en}</th>)}
              <th className="px-4 py-3 text-start font-medium">{tr("صلاحيات خاصة", "Special")}</th>
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => {
              const inPlan = m.core || featureSet.has(m.key);
              const keys = [...m.actions.map((a) => `${m.key}.${a}`), ...(m.extra ?? []).map((e) => e.key)];
              return (
                <tr key={m.key} className={`border-t border-line ${inPlan ? "" : "opacity-40"}`}>
                  <td className="px-4 py-2">
                    <button type="button" disabled={!editable} onClick={() => toggleModule(keys)} className="text-start hover:text-brand disabled:hover:text-ink">
                      {locale === "ar" ? m.ar : m.en}
                    </button>
                    {!inPlan && <span className="ms-2 text-xs text-muted">{tr("غير مشمول في الباقة", "not in plan")}</span>}
                  </td>
                  {ACTIONS.map((a) => {
                    const k = `${m.key}.${a}`;
                    return (
                      <td key={a} className="px-2 py-2 text-center">
                        {m.actions.includes(a) ? (
                          <input type="checkbox" aria-label={k} className="size-4 accent-[var(--brand)]" disabled={!editable} checked={locked || perms.has(k)} onChange={() => toggle(k)} />
                        ) : <span className="text-muted">·</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2">
                    {m.extra?.map((e) => (
                      <label key={e.key} className="inline-flex items-center gap-2 text-xs">
                        <input type="checkbox" className="size-4 accent-[var(--brand)]" disabled={!editable} checked={locked || perms.has(e.key)} onChange={() => toggle(e.key)} />
                        {locale === "ar" ? e.ar : e.en}
                      </label>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmModal open={confirmDel} onClose={() => setConfirmDel(false)} loading={del.pending}
        title={tr("حذف الدور", "Delete role")} text={tr("لا يمكن حذف دور مرتبط بمستخدمين.", "Roles assigned to users can't be deleted.")}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => {
          const ok = await del.run(() => api(`/api/roles/${role!.id}`, { method: "DELETE" }), tr("تم حذف الدور", "Role deleted"));
          setConfirmDel(false);
          if (ok) onDeleted();
        }} />
    </Card>
  );
}
