/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Header aliases (Arabic & English) → client field names. */
const ALIASES: Record<string, string> = {
  fullname: "fullName", name: "fullName", "الاسم": "fullName", "الاسم الكامل": "fullName",
  phone: "phone", mobile: "phone", "الهاتف": "phone", "رقم الهاتف": "phone", "الموبايل": "phone",
  email: "email", "البريد": "email", "البريد الإلكتروني": "email",
  gender: "gender", "الجنس": "gender", birthdate: "birthDate", "تاريخ الميلاد": "birthDate",
  address: "address", "العنوان": "address", source: "source", "المصدر": "source",
  tags: "tags", "الوسوم": "tags", notes: "notes", "ملاحظات": "notes", status: "status", "الحالة": "status", category: "category", "التصنيف": "category",
};

export function csvToClientRows(text: string) {
  const [head, ...rest] = parseCsv(text);
  if (!head) return { rows: [], unknown: [] as string[] };
  const keys = head.map((h) => ALIASES[h.trim().toLowerCase()] ?? ALIASES[h.trim()] ?? null);
  const unknown = head.filter((_, i) => !keys[i]);
  const rows = rest.map((r) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => { if (k && r[i]?.trim()) o[k] = r[i].trim(); });
    if (o.gender) o.gender = /^(f|female|أنثى|انثى)$/i.test(o.gender) ? "FEMALE" : /^(m|male|ذكر)$/i.test(o.gender) ? "MALE" : "";
    if (o.status) o.status = o.status.toUpperCase();
    return o;
  });
  return { rows, unknown };
}
