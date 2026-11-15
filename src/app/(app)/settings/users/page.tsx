"use client";
import { useEffect, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, ConfirmModal, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";

type Role = { id: string; key: string; name: string; nameAr: string };
type Branch = { id: string; name: string };
type UserRow = {
  id: string; email: string; fullName: string; phone: string | null; jobTitle: string | null; status: string; allBranches: boolean;
  locale: string; lastLoginAt: string | null; roleId: string | null; role: Role | null; branchAccess: { branchId: string; branch: { name: string } }[];
};

export default function UsersPage() {
  const s = useSession();
  const { tr, locale, can } = s;
  const [q, setQ] = useState("");
  const [roleId, setRoleId] = useState("");
  const [editing, setEditing] = useState<UserRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const allowed = can("users.view");
  const { data, loading, reload } = useResource<UserRow[]>(allowed ? `/api/users?q=${encodeURIComponent(q)}&roleId=${roleId}` : null);
  const roles = useResource<Role[]>(allowed && can("roles.view") ? "/api/roles" : null);
  const del = useSubmit();
  if (!allowed) return <Forbidden />;

  const plan = s.tenant?.plan;
  return (
    <>
      <PageHeader title={tr("المستخدمون", "Users")}
        subtitle={plan ? `${data?.length ?? "…"} / ${plan.maxUsers} ${tr("مستخدم حسب الباقة", "users on your plan")}` : undefined}
        actions={can("users.create") && <Button onClick={() => setEditing("new")}>+ {tr("مستخدم جديد", "New user")}</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder={tr("بحث بالاسم أو البريد أو الهاتف…", "Search name, email, phone…")} value={q} onChange={(e) => setQ(e.target.value)} />
          {roles.data && (
            <Select className="max-w-[220px]" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{tr("كل الأدوار", "All roles")}</option>
              {roles.data.map((r) => <option key={r.id} value={r.id}>{locale === "ar" ? r.nameAr : r.name}</option>)}
            </Select>
          )}
        </div>
        <Table head={[tr("المستخدم", "User"), tr("الدور", "Role"), tr("الفروع", "Branches"), tr("الحالة", "Status"), tr("آخر دخول", "Last sign-in"), ""]}>
          {loading ? <LoadingRows cols={6} /> : data?.map((u) => (
            <Tr key={u.id}>
              <Td>
                <p className="font-medium">{u.fullName} {u.id === s.user.id && <Badge tone="brand">{tr("أنت", "You")}</Badge>}</p>
                <p className="text-xs text-muted" dir="ltr">{u.email}</p>
                {u.jobTitle && <p className="text-xs text-muted">{u.jobTitle}</p>}
              </Td>
              <Td>{u.role ? (locale === "ar" ? u.role.nameAr : u.role.name) : "—"}</Td>
              <Td className="text-muted text-xs">{u.allBranches ? tr("كل الفروع", "All branches") : u.branchAccess.map((b) => b.branch.name).join("، ") || "—"}</Td>
              <Td><Badge tone={u.status === "ACTIVE" ? "green" : "gray"}>{u.status === "ACTIVE" ? tr("نشط", "Active") : tr("معطل", "Disabled")}</Badge></Td>
              <Td className="text-muted text-xs whitespace-nowrap">{fmtDate(u.lastLoginAt, locale, true)}</Td>
              <Td className="text-end whitespace-nowrap">
                {can("users.update") && <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>{tr("تعديل", "Edit")}</Button>}
                {can("users.delete") && u.id !== s.user.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(u)}>{tr("حذف", "Delete")}</Button>}
              </Td>
            </Tr>
          ))}
        </Table>
        {!loading && data?.length === 0 && <EmptyState title={tr("لا يوجد مستخدمون مطابقون", "No matching users")} />}
      </Card>

      <UserModal user={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={del.pending}
        title={tr("حذف المستخدم", "Delete user")}
        text={tr(`سيتم حذف ${deleting?.fullName ?? ""} نهائياً. يمكنك بدلاً من ذلك تعطيل الحساب للاحتفاظ بسجله.`, `${deleting?.fullName ?? ""} will be permanently deleted. Consider disabling instead to keep history.`)}
        confirmLabel={tr("حذف", "Delete")} cancelLabel={tr("إلغاء", "Cancel")}
        onConfirm={async () => {
          const ok = await del.run(() => api(`/api/users/${deleting!.id}`, { method: "DELETE" }), tr("تم حذف المستخدم", "User deleted"));
          setDeleting(null);
          if (ok) reload();
        }} />
    </>
  );
}

function UserModal({ user, roles, onClose, onSaved }: { user: UserRow | "new" | null; roles: Role[]; onClose: () => void; onSaved: () => void }) {
  const { tr, locale, can } = useSession();
  const isNew = user === "new";
  const branches = useResource<Branch[]>(user && can("branches.view") ? "/api/branches" : null);
  const { pending, fields, run } = useSubmit();
  const blank = { fullName: "", email: "", phone: "", jobTitle: "", password: "", roleId: "", allBranches: false, branchIds: [] as string[], status: "ACTIVE", locale: "ar" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (user === "new") setF({ ...blank, roleId: roles.find((r) => r.key === "receptionist")?.id ?? roles[0]?.id ?? "" });
    else if (user) setF({
      fullName: user.fullName, email: user.email, phone: user.phone ?? "", jobTitle: user.jobTitle ?? "", password: "", roleId: user.roleId ?? "",
      allBranches: user.allBranches, branchIds: user.branchAccess.map((b) => b.branchId), status: user.status, locale: user.locale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, roles]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));
  const toggleBranch = (id: string) => setF((x) => ({ ...x, branchIds: x.branchIds.includes(id) ? x.branchIds.filter((b) => b !== id) : [...x.branchIds, id] }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = isNew ? f : { ...f, email: undefined };
    const ok = await run(() => api(isNew ? "/api/users" : `/api/users/${(user as UserRow).id}`, { method: isNew ? "POST" : "PATCH", body }),
      isNew ? tr("تمت إضافة المستخدم", "User created") : tr("تم حفظ التعديلات", "Changes saved"));
    if (ok) onSaved();
  }

  return (
    <Modal open={!!user} onClose={onClose} wide title={isNew ? tr("مستخدم جديد", "New user") : tr("تعديل المستخدم", "Edit user")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button form="user-form" type="submit" loading={pending}>{tr("حفظ", "Save")}</Button></>}>
      <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={tr("الاسم الكامل", "Full name")} error={fields.fullName}><Input required value={f.fullName} onChange={set("fullName")} /></Field>
        <Field label={tr("البريد الإلكتروني", "Email")} error={fields.email}><Input required type="email" dir="ltr" disabled={!isNew} value={f.email} onChange={set("email")} /></Field>
        <Field label={tr("الهاتف", "Phone")}><Input dir="ltr" value={f.phone} onChange={set("phone")} /></Field>
        <Field label={tr("المسمى الوظيفي", "Job title")}><Input value={f.jobTitle} onChange={set("jobTitle")} /></Field>
        <Field label={tr("الدور", "Role")} error={fields.roleId}>
          <Select required value={f.roleId} onChange={set("roleId")}>
            {roles.map((r) => <option key={r.id} value={r.id}>{locale === "ar" ? r.nameAr : r.name}</option>)}
          </Select>
        </Field>
        <Field label={isNew ? tr("كلمة المرور", "Password") : tr("كلمة مرور جديدة (اختياري)", "New password (optional)")} error={fields.password}
          hint={tr("8 أحرف على الأقل، حروف وأرقام. تغييرها يسجّل خروج المستخدم من كل الأجهزة.", "8+ chars, letters & digits. Changing it signs the user out everywhere.")}>
          <Input type="password" dir="ltr" required={isNew} autoComplete="new-password" value={f.password} onChange={set("password")} />
        </Field>
        <Field label={tr("الحالة", "Status")}>
          <Select value={f.status} onChange={set("status")}><option value="ACTIVE">{tr("نشط", "Active")}</option><option value="DISABLED">{tr("معطل", "Disabled")}</option></Select>
        </Field>
        <Field label={tr("لغة الواجهة", "Language")}>
          <Select value={f.locale} onChange={set("locale")}><option value="ar">العربية</option><option value="en">English</option></Select>
        </Field>
        <div className="sm:col-span-2 border-t border-line pt-4">
          <p className="mb-2 font-medium">{tr("صلاحية الفروع", "Branch access")}</p>
          <Checkbox label={tr("الوصول إلى جميع الفروع", "Access to all branches")} checked={f.allBranches} onChange={set("allBranches")} />
          {!f.allBranches && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {branches.data?.map((b) => <Checkbox key={b.id} label={b.name} checked={f.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />)}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
