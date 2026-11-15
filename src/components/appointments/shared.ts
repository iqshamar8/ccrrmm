export type Appt = {
  id: string; branchId: string; clientId: string; serviceId: string | null; staffId: string | null; roomId: string | null;
  startsAt: string; endsAt: string; status: string; price: string | null; notes: string | null; cancelReason: string | null;
  bookingSource: string | null; recurrenceGroupId: string | null;
  client: { id: string; code: string; fullName: string; phone: string };
  service: { id: string; name: string; color: string | null; kind: string } | null;
  staff: { id: string; fullName: string } | null;
  room: { id: string; name: string } | null;
  branch: { id: string; name: string };
  programItem?: { id: string; program: { id: string; code: string; name: string } } | null;
  subscription?: { id: string; code: string; name: string } | null;
  surgery?: { id: string; code: string } | null;
  review?: { id: string } | null;
};
export type Staff = { id: string; fullName: string; jobTitle: string | null; allBranches: boolean; branchIds: string[]; role: { key: string; nameAr: string; name: string } | null };
export type Room = { id: string; name: string; kind: string; branchId: string; isActive: boolean; branch: { name: string } };
export type Service = {
  id: string; name: string; nameEn: string | null; categoryId: string | null; kind: string; price: string; durationMin: number; color: string | null;
  isActive: boolean; staffIds: string[]; branchPrices: { branchId: string; price: string }[];
};
export type Category = { id: string; parentId: string | null; name: string; nameEn: string | null; sortOrder: number; isActive: boolean };
export type Catalog = { categories: Category[]; services: Service[] };

/** yyyy-mm-dd / HH:MM in the browser's local time */
export const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const toTimeInput = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const fromInputs = (date: string, time: string) => new Date(`${date}T${time}:00`);
export const fmtTime = (d: string | Date, locale: string) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(d));
