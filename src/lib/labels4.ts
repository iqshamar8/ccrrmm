/** Phase 4 bilingual labels. */
type Tone = "gray" | "green" | "red" | "amber" | "blue" | "brand";
type L = { ar: string; en: string; tone?: Tone };
export const INVOICE_STATUS: Record<string, L> = {
  DRAFT: { ar: "مسودة", en: "Draft", tone: "gray" }, ISSUED: { ar: "صادرة — غير مدفوعة", en: "Issued — unpaid", tone: "amber" },
  PARTIALLY_PAID: { ar: "مدفوعة جزئياً", en: "Partially paid", tone: "blue" }, PAID: { ar: "مدفوعة", en: "Paid", tone: "green" },
  CANCELLED: { ar: "ملغاة", en: "Cancelled", tone: "gray" }, REFUNDED: { ar: "مستردة", en: "Refunded", tone: "red" },
};
export const INVOICE_TYPE: Record<string, L> = {
  SERVICE: { ar: "خدمات", en: "Services" }, SALE: { ar: "بيع مباشر", en: "Retail sale" }, PROGRAM: { ar: "برنامج علاجي", en: "Program" },
  SUBSCRIPTION: { ar: "اشتراك", en: "Subscription" }, SURGERY: { ar: "عملية جراحية", en: "Surgery" }, MIXED: { ar: "متعددة", en: "Mixed" },
};
export const LINE_KIND: Record<string, L> = {
  SERVICE: { ar: "خدمة", en: "Service" }, PRODUCT: { ar: "منتج", en: "Product" }, PROGRAM: { ar: "برنامج", en: "Program" },
  SUBSCRIPTION: { ar: "اشتراك", en: "Subscription" }, SURGERY: { ar: "عملية", en: "Surgery" }, OTHER: { ar: "أخرى", en: "Other" },
};
export const PAY_METHOD: Record<string, L> = {
  CASH: { ar: "نقداً", en: "Cash" }, CARD: { ar: "بطاقة", en: "Card" }, TRANSFER: { ar: "تحويل", en: "Transfer" }, OTHER: { ar: "أخرى", en: "Other" },
};
export const COMMISSION_SOURCE: Record<string, L> = {
  SERVICE_EXEC: { ar: "تنفيذ خدمة", en: "Service execution" }, SERVICE_MARKETING: { ar: "تسويق خدمة", en: "Service marketing" },
  SURGERY: { ar: "عملية جراحية", en: "Surgery" }, REVIEW: { ar: "مراجعة طبية", en: "Medical review" }, COUPON: { ar: "كوبون", en: "Coupon" },
  PRODUCT_SALE: { ar: "مبيعات", en: "Sales" }, ADJUSTMENT: { ar: "تسوية يدوية", en: "Adjustment" },
};
export const COMMISSION_STATUS: Record<string, L> = {
  PENDING: { ar: "قيد الاعتماد", en: "Pending", tone: "amber" }, APPROVED: { ar: "معتمدة", en: "Approved", tone: "blue" },
  PAID: { ar: "مدفوعة", en: "Paid", tone: "green" }, VOID: { ar: "ملغاة", en: "Void", tone: "gray" },
};
export const ATT_STATUS: Record<string, L> = {
  PRESENT: { ar: "حاضر", en: "Present", tone: "green" }, LATE: { ar: "متأخر", en: "Late", tone: "amber" },
  ABSENT: { ar: "غائب", en: "Absent", tone: "red" }, LEAVE: { ar: "إجازة", en: "On leave", tone: "blue" },
};
export const LEAVE_TYPE: Record<string, L> = { ANNUAL: { ar: "سنوية", en: "Annual" }, SICK: { ar: "مرضية", en: "Sick" }, UNPAID: { ar: "بدون راتب", en: "Unpaid" }, OTHER: { ar: "أخرى", en: "Other" } };
export const LEAVE_STATUS: Record<string, L> = {
  PENDING: { ar: "بانتظار الموافقة", en: "Pending", tone: "amber" }, APPROVED: { ar: "موافق عليها", en: "Approved", tone: "green" },
  REJECTED: { ar: "مرفوضة", en: "Rejected", tone: "red" }, CANCELLED: { ar: "ملغاة", en: "Cancelled", tone: "gray" },
};
export const PAYROLL_STATUS: Record<string, L> = { DRAFT: { ar: "مسودة", en: "Draft", tone: "gray" }, APPROVED: { ar: "معتمدة", en: "Approved", tone: "blue" }, PAID: { ar: "مصروفة", en: "Paid", tone: "green" } };
export const EMP_STATUS: Record<string, L> = { ACTIVE: { ar: "على رأس العمل", en: "Active", tone: "green" }, ON_LEAVE: { ar: "في إجازة", en: "On leave", tone: "blue" }, SUSPENDED: { ar: "موقوف", en: "Suspended", tone: "amber" }, TERMINATED: { ar: "منتهي الخدمة", en: "Terminated", tone: "gray" } };
export const DAYS = [["الأحد", "Sun"], ["الاثنين", "Mon"], ["الثلاثاء", "Tue"], ["الأربعاء", "Wed"], ["الخميس", "Thu"], ["الجمعة", "Fri"], ["السبت", "Sat"]] as const;

export const l4 = (m: Record<string, L>, k: string | null | undefined, locale: string) => (k && m[k] ? (locale === "ar" ? m[k].ar : m[k].en) : k ?? "—");
export const t4 = (m: Record<string, L>, k: string) => m[k]?.tone ?? "gray";
