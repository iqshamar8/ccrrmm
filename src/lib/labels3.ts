/** Phase 3 bilingual labels. */
type Tone = "gray" | "green" | "red" | "amber" | "blue" | "brand";
type L = { ar: string; en: string; tone?: Tone };
export const lbl = (m: Record<string, L>, k: string | null | undefined, locale: string) => (k && m[k] ? (locale === "ar" ? m[k].ar : m[k].en) : k ?? "—");

export const PROGRAM_STATUS: Record<string, L> = {
  ACTIVE: { ar: "نشط", en: "Active", tone: "green" }, PAUSED: { ar: "متوقف مؤقتاً", en: "Paused", tone: "amber" },
  COMPLETED: { ar: "مكتمل", en: "Completed", tone: "blue" }, CANCELLED: { ar: "ملغى", en: "Cancelled", tone: "gray" },
  EXPIRED: { ar: "منتهي الصلاحية", en: "Expired", tone: "red" },
};
export const SUB_STATUS: Record<string, L> = {
  ACTIVE: { ar: "نشط", en: "Active", tone: "green" }, FROZEN: { ar: "مجمّد", en: "Frozen", tone: "blue" },
  CANCELLED: { ar: "ملغى", en: "Cancelled", tone: "gray" }, EXPIRED: { ar: "منتهي", en: "Expired", tone: "red" },
};
export const SUB_KIND: Record<string, L> = {
  TIME: { ar: "اشتراك زمني (غير محدود)", en: "Time-based (unlimited)" }, VISITS: { ar: "عدد زيارات", en: "Visit pack" }, SESSIONS: { ar: "عدد جلسات", en: "Session pack" },
};
export const SURGERY_STATUS: Record<string, L> = {
  PLANNED: { ar: "مخطط لها", en: "Planned", tone: "blue" }, CONFIRMED: { ar: "مؤكدة", en: "Confirmed", tone: "brand" },
  IN_PROGRESS: { ar: "جارية", en: "In progress", tone: "amber" }, COMPLETED: { ar: "مكتملة", en: "Completed", tone: "green" },
  POSTPONED: { ar: "مؤجلة", en: "Postponed", tone: "amber" }, CANCELLED: { ar: "ملغاة", en: "Cancelled", tone: "gray" },
};
export const RECOVERY: Record<string, L> = {
  NOT_STARTED: { ar: "لم تبدأ", en: "Not started", tone: "gray" }, STABLE: { ar: "مستقرة", en: "Stable", tone: "green" },
  NEEDS_ATTENTION: { ar: "تحتاج متابعة", en: "Needs attention", tone: "amber" }, COMPLICATED: { ar: "مضاعفات", en: "Complicated", tone: "red" },
  RECOVERED: { ar: "تعافٍ تام", en: "Recovered", tone: "blue" },
};
export const TEAM_ROLE: Record<string, L> = {
  ASSISTANT: { ar: "مساعد جراح", en: "Assistant" }, ANESTHETIST: { ar: "طبيب تخدير", en: "Anesthetist" }, NURSE: { ar: "تمريض", en: "Nurse" },
  TECHNICIAN: { ar: "فني", en: "Technician" }, OTHER: { ar: "أخرى", en: "Other" },
};
export const REVIEW_STATUS: Record<string, L> = {
  SCHEDULED: { ar: "مجدولة", en: "Scheduled", tone: "blue" }, COMPLETED: { ar: "مكتملة", en: "Completed", tone: "green" },
  MISSED: { ar: "لم يحضر", en: "Missed", tone: "red" }, CANCELLED: { ar: "ملغاة", en: "Cancelled", tone: "gray" },
};
export const REVIEW_REASON: Record<string, L> = {
  POST_OP: { ar: "ما بعد العملية", en: "Post-op" }, ROUTINE: { ar: "دورية", en: "Routine" }, COMPLAINT: { ar: "شكوى", en: "Complaint" },
  TREATMENT: { ar: "متابعة علاج", en: "Treatment follow-up" }, RESULT: { ar: "مراجعة نتائج", en: "Results" }, OTHER: { ar: "أخرى", en: "Other" },
};
export const OUTCOME: Record<string, L> = {
  IMPROVED: { ar: "تحسّن", en: "Improved", tone: "green" }, STABLE: { ar: "مستقر", en: "Stable", tone: "blue" },
  WORSE: { ar: "تراجع", en: "Worse", tone: "red" }, RESOLVED: { ar: "شُفي", en: "Resolved", tone: "brand" },
};
export const tone = (m: Record<string, L>, k: string) => m[k]?.tone ?? "gray";
