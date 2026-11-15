/** Phase 2 bilingual labels: clients, appointments, services, medical. */
type L = { ar: string; en: string };
type Tone = "gray" | "green" | "red" | "amber" | "blue" | "brand";
const t = (m: Record<string, L>, k: string | null | undefined, locale: string) => (k && m[k] ? (locale === "ar" ? m[k].ar : m[k].en) : k ?? "—");

export const CLIENT_STATUS: Record<string, L & { tone: Tone }> = {
  LEAD: { ar: "عميل محتمل", en: "Lead", tone: "amber" },
  ACTIVE: { ar: "نشط", en: "Active", tone: "green" },
  INACTIVE: { ar: "غير نشط", en: "Inactive", tone: "gray" },
  BLOCKED: { ar: "محظور", en: "Blocked", tone: "red" },
};
export const SOURCES: Record<string, L> = {
  walk_in: { ar: "حضور مباشر", en: "Walk-in" }, phone: { ar: "اتصال هاتفي", en: "Phone" }, instagram: { ar: "إنستغرام", en: "Instagram" },
  facebook: { ar: "فيسبوك", en: "Facebook" }, tiktok: { ar: "تيك توك", en: "TikTok" }, snapchat: { ar: "سناب شات", en: "Snapchat" },
  google: { ar: "جوجل", en: "Google" }, website: { ar: "الموقع", en: "Website" }, whatsapp: { ar: "واتساب", en: "WhatsApp" },
  referral: { ar: "توصية", en: "Referral" }, influencer: { ar: "مؤثر", en: "Influencer" }, corporate: { ar: "شركة متعاقدة", en: "Corporate" },
  other: { ar: "أخرى", en: "Other" },
};
export const CATEGORIES: Record<string, L> = { REGULAR: { ar: "عادي", en: "Regular" }, VIP: { ar: "VIP", en: "VIP" }, CORPORATE: { ar: "شركات", en: "Corporate" } };

export const APPT_STATUS: Record<string, L & { tone: Tone; color: string }> = {
  SCHEDULED: { ar: "محجوز", en: "Scheduled", tone: "blue", color: "#0284c7" },
  CONFIRMED: { ar: "مؤكد", en: "Confirmed", tone: "brand", color: "#0f766e" },
  CHECKED_IN: { ar: "حاضر", en: "Checked in", tone: "amber", color: "#d97706" },
  COMPLETED: { ar: "مكتمل", en: "Completed", tone: "green", color: "#059669" },
  CANCELLED: { ar: "ملغى", en: "Cancelled", tone: "gray", color: "#9ca3af" },
  NO_SHOW: { ar: "لم يحضر", en: "No-show", tone: "red", color: "#dc2626" },
};
export const SERVICE_KIND: Record<string, L> = {
  CONSULTATION: { ar: "استشارة", en: "Consultation" }, MEDICAL: { ar: "طبية", en: "Medical" }, COSMETIC: { ar: "تجميلية", en: "Cosmetic" },
  LASER: { ar: "ليزر", en: "Laser" }, DENTAL: { ar: "أسنان", en: "Dental" }, SURGERY: { ar: "عملية جراحية", en: "Surgery" },
  FOLLOW_UP: { ar: "مراجعة", en: "Follow-up" }, OTHER: { ar: "أخرى", en: "Other" },
};
export const ROOM_KIND: Record<string, L> = {
  TREATMENT: { ar: "غرفة علاج", en: "Treatment" }, LASER: { ar: "غرفة ليزر", en: "Laser" }, CONSULTATION: { ar: "عيادة استشارة", en: "Consultation" },
  OPERATING: { ar: "صالة عمليات", en: "Operating room" }, DENTAL: { ar: "كرسي أسنان", en: "Dental chair" },
};
export const MED_ENTRY: Record<string, L> = {
  DIAGNOSIS: { ar: "تشخيص", en: "Diagnosis" }, NOTE: { ar: "ملاحظة طبية", en: "Medical note" },
  TREATMENT_PLAN: { ar: "خطة علاجية", en: "Treatment plan" }, FOLLOW_UP_RESULT: { ar: "نتيجة متابعة", en: "Follow-up result" },
};
export const FILE_CAT: Record<string, L> = {
  CLIENT_PHOTO: { ar: "صورة العميل", en: "Client photo" }, MEDICAL_BEFORE: { ar: "قبل العلاج", en: "Before" },
  MEDICAL_AFTER: { ar: "بعد العلاج", en: "After" }, MEDICAL_DOCUMENT: { ar: "مستند طبي", en: "Medical document" },
};
export const INTERACTION: Record<string, L> = {
  NOTE: { ar: "ملاحظة", en: "Note" }, CALL: { ar: "مكالمة", en: "Call" }, WHATSAPP: { ar: "واتساب", en: "WhatsApp" },
  EMAIL: { ar: "بريد", en: "Email" }, VISIT: { ar: "زيارة", en: "Visit" }, SYSTEM: { ar: "النظام", en: "System" },
};

export const clientStatusLabel = (k: string, l: string) => t(CLIENT_STATUS, k, l);
export const sourceLabel = (k: string | null, l: string) => t(SOURCES, k, l);
export const apptStatusLabel = (k: string, l: string) => t(APPT_STATUS, k, l);
export const serviceKindLabel = (k: string, l: string) => t(SERVICE_KIND, k, l);
export const roomKindLabel = (k: string, l: string) => t(ROOM_KIND, k, l);
export const medEntryLabel = (k: string, l: string) => t(MED_ENTRY, k, l);
export const fileCatLabel = (k: string, l: string) => t(FILE_CAT, k, l);
export const interactionLabel = (k: string, l: string) => t(INTERACTION, k, l);

/** SYSTEM interactions are stored as codes ("appointment.booked:Laser:2026-...") → readable text. */
export function systemText(content: string, locale: string, fmt: (d: string) => string) {
  const [code, ...rest] = content.split(":");
  const arg = rest.join(":");
  const tr = (ar: string, en: string) => (locale === "ar" ? ar : en);
  switch (code) {
    case "client.created": return tr("تم إنشاء ملف العميل", "Client file created");
    case "lead.created": return tr("تسجيل كعميل محتمل", "Registered as a lead");
    case "lead.converted": return tr("تحوّل من عميل محتمل إلى عميل فعلي", "Converted from lead to client");
    case "client.imported": return tr("تم استيراده من ملف", "Imported from file");
    case "client.merged": return tr(`دُمج معه الملف ${arg}`, `Merged with ${arg}`);
    case "client.branch_transfer": return tr(`نُقل إلى ${arg}`, `Transferred to ${arg}`);
    case "appointment.booked": {
      const [svc, iso, count] = arg.split(/:(?=\d{4}-|x\d)/);
      return tr(`حجز موعد ${svc !== "-" ? svc : ""} بتاريخ ${iso ? fmt(iso) : ""}${count ? ` (${count.slice(1)} مواعيد)` : ""}`,
        `Booked ${svc !== "-" ? svc : "appointment"} for ${iso ? fmt(iso) : ""}${count ? ` (${count.slice(1)} sessions)` : ""}`);
    }
    case "appointment.rescheduled": return tr(`إعادة جدولة الموعد إلى ${fmt(arg)}`, `Rescheduled to ${fmt(arg)}`);
    case "appointment.cancelled": return tr(`إلغاء موعد${arg ? ` — ${arg}` : ""}`, `Appointment cancelled${arg ? ` — ${arg}` : ""}`);
    case "appointment.no_show": return tr("لم يحضر الموعد", "Missed appointment");
    case "visit.completed": return tr(`زيارة مكتملة: ${arg}`, `Visit completed: ${arg}`);
    default: return content;
  }
}
