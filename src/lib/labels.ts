import { TENANT_TYPES } from "./permissions";

type L = { ar: string; en: string };
const pick = (m: Record<string, L>, k: string, locale: string) => (m[k] ? (locale === "ar" ? m[k].ar : m[k].en) : k);

export const TENANT_STATUS: Record<string, L & { tone: "green" | "amber" | "red" | "gray" }> = {
  TRIAL: { ar: "تجريبي", en: "Trial", tone: "amber" },
  ACTIVE: { ar: "نشط", en: "Active", tone: "green" },
  SUSPENDED: { ar: "موقوف", en: "Suspended", tone: "red" },
  CANCELLED: { ar: "ملغى", en: "Cancelled", tone: "gray" },
};
export const SUB_STATUS: Record<string, L> = {
  TRIALING: { ar: "تجريبي", en: "Trialing" }, ACTIVE: { ar: "نشط", en: "Active" }, PAST_DUE: { ar: "متأخر السداد", en: "Past due" },
  PAUSED: { ar: "مجمّد", en: "Paused" }, CANCELLED: { ar: "ملغى", en: "Cancelled" }, EXPIRED: { ar: "منتهي", en: "Expired" },
};
export const CYCLE: Record<string, L> = { MONTHLY: { ar: "شهري", en: "Monthly" }, YEARLY: { ar: "سنوي", en: "Yearly" } };

export const tenantTypeLabel = (k: string, locale: string) => {
  const t = TENANT_TYPES.find((x) => x.key === k);
  return t ? (locale === "ar" ? t.ar : t.en) : k;
};
export const subStatusLabel = (k: string, locale: string) => pick(SUB_STATUS, k, locale);
export const cycleLabel = (k: string, locale: string) => pick(CYCLE, k, locale);

const ACTIONS: Record<string, L> = {
  "auth.login": { ar: "تسجيل دخول", en: "Signed in" },
  "auth.login.failed": { ar: "محاولة دخول فاشلة", en: "Failed sign-in" },
  "auth.password.change": { ar: "تغيير كلمة المرور", en: "Password changed" },
  "tenant.create": { ar: "إنشاء مؤسسة", en: "Organization created" },
  "tenant.update": { ar: "تعديل مؤسسة", en: "Organization updated" },
  "tenant.status.active": { ar: "تفعيل مؤسسة", en: "Organization activated" },
  "tenant.status.suspended": { ar: "إيقاف مؤسسة", en: "Organization suspended" },
  "tenant.status.cancelled": { ar: "إلغاء مؤسسة", en: "Organization cancelled" },
  "tenant.status.trial": { ar: "تحويل لتجريبي", en: "Set to trial" },
  "tenant.plan.change": { ar: "تغيير الباقة", en: "Plan changed" },
  "plan.create": { ar: "إنشاء باقة", en: "Plan created" },
  "plan.update": { ar: "تعديل باقة", en: "Plan updated" },
  "user.create": { ar: "إضافة مستخدم", en: "User created" },
  "user.update": { ar: "تعديل مستخدم", en: "User updated" },
  "user.update.password": { ar: "إعادة تعيين كلمة مرور", en: "Password reset" },
  "user.delete": { ar: "حذف مستخدم", en: "User deleted" },
  "role.create": { ar: "إنشاء دور", en: "Role created" },
  "role.update": { ar: "تعديل دور", en: "Role updated" },
  "role.delete": { ar: "حذف دور", en: "Role deleted" },
  "branch.create": { ar: "إضافة فرع", en: "Branch created" },
  "branch.update": { ar: "تعديل فرع", en: "Branch updated" },
  "branch.delete": { ar: "حذف فرع", en: "Branch deleted" },
  "organization.update": { ar: "تعديل إعدادات المؤسسة", en: "Settings updated" },
};
export const actionLabel = (k: string, locale: string) => pick(ACTIONS, k, locale);
