/** Shared labels for messaging & marketing screens: [ar, en, tone]. */
type Tone = "gray" | "green" | "red" | "amber" | "blue" | "brand";

export const CATEGORY: Record<string, [string, string]> = {
  APPOINTMENT_CONFIRM: ["تأكيد الحجز", "Booking confirmation"], APPOINTMENT_REMINDER: ["تذكير بالموعد", "Appointment reminder"],
  PAYMENT_REMINDER: ["تذكير بالدفع", "Payment reminder"], SUBSCRIPTION_EXPIRY: ["انتهاء الاشتراك", "Subscription expiry"],
  SESSION_REMINDER: ["تذكير بالجلسات", "Session reminder"], FOLLOW_UP: ["متابعة بعد الخدمة", "Post-visit follow-up"],
  BIRTHDAY: ["عيد ميلاد", "Birthday"], PROMOTION: ["عروض وخصومات", "Promotion"], REACTIVATION: ["استعادة عميل", "Win-back"], CUSTOM: ["رسالة حرة", "Custom message"],
};
export const STATUS: Record<string, [string, string, Tone]> = {
  QUEUED: ["بالانتظار", "Queued", "gray"], SENDING: ["قيد الإرسال", "Sending", "blue"], SENT: ["أُرسلت", "Sent", "blue"], DELIVERED: ["وصلت", "Delivered", "green"],
  READ: ["قُرئت", "Read", "brand"], FAILED: ["فشلت", "Failed", "red"], CANCELLED: ["ملغاة", "Cancelled", "amber"],
};
export const CAMPAIGN_STATUS: Record<string, [string, string, Tone]> = {
  DRAFT: ["مسودة", "Draft", "gray"], SCHEDULED: ["مجدولة", "Scheduled", "blue"], SENDING: ["قيد الإرسال", "Sending", "amber"], SENT: ["أُرسلت", "Sent", "green"], CANCELLED: ["ملغاة", "Cancelled", "red"],
};
export const OBJECTIVE: Record<string, [string, string]> = {
  PROMOTION: ["ترويج عرض", "Promotion"], REACTIVATION: ["استعادة العملاء", "Win-back"], REMINDER: ["تذكير", "Reminder"], AWARENESS: ["توعية", "Awareness"], EVENT: ["مناسبة", "Event"],
};
export const PLACEHOLDERS: [string, string, string][] = [
  ["client_name", "اسم العميل", "Client name"], ["clinic_name", "اسم العيادة", "Clinic name"], ["branch_name", "الفرع", "Branch"], ["date", "التاريخ", "Date"], ["time", "الوقت", "Time"],
  ["service", "الخدمة", "Service"], ["staff", "الموظف", "Staff"], ["amount", "المبلغ", "Amount"], ["invoice_code", "رقم الفاتورة", "Invoice no."], ["due_date", "تاريخ الاستحقاق", "Due date"],
  ["plan_name", "الاشتراك", "Subscription"], ["end_date", "تاريخ الانتهاء", "End date"], ["program_name", "البرنامج", "Program"], ["remaining", "الجلسات المتبقية", "Sessions left"],
  ["coupon_code", "كود الخصم", "Coupon code"], ["offer", "العرض", "Offer"], ["message", "نص حر", "Free text"],
];
