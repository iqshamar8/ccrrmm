/**
 * Permission catalog — single source of truth shared by server and UI.
 *
 * A permission key is "<module>.<action>", e.g. "clients.view".
 * Effective access = role has the key AND the tenant's plan enables the module
 * (core modules are always enabled).
 */

export const ACTIONS = ["view", "create", "update", "delete", "approve", "print", "export"] as const;
export type Action = (typeof ACTIONS)[number];

export type ModuleDef = {
  key: string;
  ar: string;
  en: string;
  /** core modules are part of every plan and cannot be disabled */
  core?: boolean;
  actions: readonly Action[];
  /** extra fine-grained permissions, e.g. medical.view_data */
  extra?: readonly { key: string; ar: string; en: string }[];
  phase: number;
};

const CRUD = ["view", "create", "update", "delete"] as const;
const CRUDX = ["view", "create", "update", "delete", "print", "export"] as const;
const ALL = ACTIONS;

export const MODULES: readonly ModuleDef[] = [
  // finance.view_data lives on a core module: money visibility must not depend on the Accounting add-on.
  { key: "dashboard", ar: "لوحة التحكم", en: "Dashboard", core: true, actions: ["view"], phase: 1,
    extra: [{ key: "finance.view_data", ar: "مشاهدة البيانات المالية", en: "View financial data" }] },
  { key: "clients", ar: "العملاء", en: "Clients", actions: CRUDX, phase: 2,
    extra: [{ key: "clients.merge", ar: "دمج الملفات المكررة", en: "Merge duplicates" }] },
  { key: "medical", ar: "الملف الطبي", en: "Medical records", actions: ["view", "create", "update", "delete", "print"], phase: 2,
    extra: [{ key: "medical.view_data", ar: "مشاهدة البيانات الطبية", en: "View medical data" }] },
  { key: "appointments", ar: "المواعيد", en: "Appointments", actions: CRUDX, phase: 2 },
  { key: "services", ar: "الخدمات", en: "Services", actions: CRUDX, phase: 2 },
  { key: "programs", ar: "البرامج العلاجية", en: "Treatment programs", actions: CRUDX, phase: 3 },
  { key: "subscriptions", ar: "اشتراكات العملاء", en: "Client subscriptions", actions: CRUDX, phase: 3 },
  { key: "surgeries", ar: "العمليات الجراحية", en: "Surgeries", actions: CRUDX, phase: 3 },
  { key: "reviews", ar: "المراجعات الطبية", en: "Medical follow-ups", actions: CRUDX, phase: 3 },
  { key: "invoices", ar: "الفواتير", en: "Invoices", actions: ALL, phase: 4 },
  { key: "pos", ar: "البيع المباشر", en: "Point of sale", actions: ["view", "create", "print"], phase: 4 },
  { key: "coupons", ar: "الكوبونات", en: "Coupons", actions: CRUDX, phase: 4 },
  { key: "loyalty", ar: "نقاط الولاء", en: "Loyalty", actions: CRUD, phase: 4 },
  { key: "hr", ar: "الموارد البشرية", en: "HR", actions: ALL, phase: 4 },
  { key: "commissions", ar: "العمولات", en: "Commissions", actions: ALL, phase: 4 },
  { key: "inventory", ar: "المخازن", en: "Inventory", actions: ALL, phase: 5 },
  { key: "accounting", ar: "المحاسبة", en: "Accounting", actions: ALL, phase: 5 },
  { key: "corporate", ar: "الشركات المتعاقدة", en: "Corporate contracts", actions: CRUDX, phase: 5 },
  { key: "marketing", ar: "التسويق", en: "Marketing", actions: CRUDX, phase: 6 },
  { key: "notifications", ar: "الإشعارات", en: "Notifications", actions: CRUD, phase: 6 },
  { key: "reports", ar: "التقارير", en: "Reports", actions: ["view", "print", "export"], phase: 6 },
  { key: "branches", ar: "الفروع", en: "Branches", core: true, actions: CRUD, phase: 1,
    extra: [{ key: "branches.view_all", ar: "مشاهدة بيانات كل الفروع", en: "View all branches' data" }] },
  { key: "users", ar: "المستخدمون", en: "Users", core: true, actions: CRUD, phase: 1 },
  { key: "roles", ar: "الأدوار والصلاحيات", en: "Roles & permissions", core: true, actions: CRUD, phase: 1 },
  { key: "audit", ar: "سجل العمليات", en: "Audit log", core: true, actions: ["view", "export"], phase: 1 },
  { key: "settings", ar: "إعدادات المؤسسة", en: "Organization settings", core: true, actions: ["view", "update"], phase: 1 },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
export const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.key);
export const OPTIONAL_MODULES = MODULES.filter((m) => !m.core).map((m) => m.key);

/** Every permission key that exists. */
export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) => [
  ...m.actions.map((a) => `${m.key}.${a}`),
  ...(m.extra ?? []).map((e) => e.key),
]);
const PERMISSION_SET = new Set(ALL_PERMISSIONS);

export function isValidPermission(key: string) {
  return PERMISSION_SET.has(key);
}

/** "finance.view_data" belongs to module "accounting"; others to their prefix. */
export function moduleOfPermission(key: string): string {
  for (const m of MODULES) if (m.extra?.some((e) => e.key === key)) return m.key;
  return key.split(".")[0];
}

export const ACTION_LABELS: Record<Action, { ar: string; en: string }> = {
  view: { ar: "مشاهدة", en: "View" },
  create: { ar: "إضافة", en: "Create" },
  update: { ar: "تعديل", en: "Update" },
  delete: { ar: "حذف", en: "Delete" },
  approve: { ar: "اعتماد", en: "Approve" },
  print: { ar: "طباعة", en: "Print" },
  export: { ar: "تصدير", en: "Export" },
};

// ------------------------------------------------------- default roles ----

const perms = (mods: string[], actions: readonly Action[] | "all") =>
  mods.flatMap((m) => {
    const def = MODULES.find((x) => x.key === m)!;
    const acts = actions === "all" ? def.actions : def.actions.filter((a) => actions.includes(a));
    return acts.map((a) => `${m}.${a}`);
  });

export type DefaultRole = { key: string; name: string; nameAr: string; permissions: string[] };

export const DEFAULT_ROLES: DefaultRole[] = [
  { key: "tenant_admin", name: "Organization admin", nameAr: "مدير المؤسسة", permissions: [...ALL_PERMISSIONS] },
  {
    key: "branch_manager", name: "Branch manager", nameAr: "مدير الفرع",
    permissions: [
      ...perms(["dashboard", "clients", "appointments", "services", "programs", "subscriptions", "surgeries", "reviews",
        "invoices", "pos", "coupons", "loyalty", "hr", "inventory", "reports"], "all"),
      ...perms(["users", "branches", "audit", "settings"], ["view"]),
      "medical.view", "finance.view_data",
    ],
  },
  {
    key: "accountant", name: "Accountant", nameAr: "مدير الحسابات",
    permissions: [
      ...perms(["accounting", "invoices", "commissions"], "all"),
      ...perms(["dashboard", "clients", "pos", "inventory", "hr"], ["view"]),
      ...perms(["reports"], "all"), "finance.view_data",
    ],
  },
  {
    key: "receptionist", name: "Receptionist", nameAr: "موظف الاستقبال",
    permissions: [
      ...perms(["clients", "appointments"], ["view", "create", "update", "print"]),
      ...perms(["dashboard", "services", "programs", "subscriptions"], ["view"]),
      ...perms(["pos"], "all"), "invoices.view", "invoices.create", "invoices.print",
    ],
  },
  {
    key: "doctor", name: "Doctor", nameAr: "الطبيب",
    permissions: [
      ...perms(["medical", "surgeries", "reviews", "programs"], "all"),
      ...perms(["dashboard", "clients", "appointments", "services"], ["view"]),
      "appointments.update", "medical.view_data",
    ],
  },
  {
    key: "nurse", name: "Nurse", nameAr: "الممرض",
    permissions: [
      ...perms(["dashboard", "clients", "appointments", "services", "surgeries", "reviews", "programs"], ["view"]),
      "medical.view", "medical.create", "medical.update", "medical.view_data", "inventory.view",
    ],
  },
  {
    key: "sales", name: "Sales", nameAr: "موظف المبيعات",
    permissions: [
      ...perms(["clients"], ["view", "create", "update"]),
      ...perms(["pos", "coupons"], "all"),
      ...perms(["dashboard", "services", "programs", "subscriptions", "loyalty"], ["view"]),
      "invoices.view", "invoices.create", "subscriptions.create",
    ],
  },
  {
    key: "inventory_manager", name: "Inventory manager", nameAr: "مسؤول المخازن",
    permissions: [...perms(["inventory"], "all"), ...perms(["dashboard", "services", "reports"], ["view"])],
  },
  {
    key: "hr_manager", name: "HR manager", nameAr: "مسؤول الموارد البشرية",
    permissions: [...perms(["hr", "commissions"], "all"), ...perms(["dashboard", "users", "branches", "reports"], ["view"])],
  },
  {
    key: "marketing", name: "Marketing", nameAr: "موظف التسويق",
    permissions: [
      ...perms(["marketing", "coupons", "notifications"], "all"),
      ...perms(["dashboard", "clients", "services", "loyalty", "reports"], ["view"]),
      "clients.export",
    ],
  },
];

export const TENANT_TYPES = [
  { key: "MEDICAL_CLINIC", ar: "عيادة طبية", en: "Medical clinic" },
  { key: "BEAUTY_LASER_CENTER", ar: "مركز تجميل وليزر", en: "Beauty & laser center" },
  { key: "DENTAL_CENTER", ar: "مركز أسنان", en: "Dental center" },
  { key: "DERMATOLOGY_CENTER", ar: "مركز جلدية", en: "Dermatology center" },
  { key: "HOSPITAL", ar: "مستشفى أو مجمع طبي", en: "Hospital / medical complex" },
  { key: "MEDICAL_SERVICES_COMPANY", ar: "شركة خدمات طبية", en: "Medical services company" },
  { key: "CLINIC_MANAGEMENT_COMPANY", ar: "شركة تسويق أو إدارة عيادات", en: "Clinic marketing / management" },
  { key: "MULTI_BRANCH_ORG", ar: "مؤسسة متعددة الفروع", en: "Multi-branch organization" },
] as const;
