import { rawRoute } from "@/server/api";
import { exportClients } from "@/server/services/clients";

const esc = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? v.join(";") : String(v ?? "");
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const GET = rawRoute(async ({ ctx, search }) => {
  const rows = await exportClients(ctx, {
    search: search.get("q") ?? undefined, status: search.get("status") ?? undefined, source: search.get("source") ?? undefined,
    tag: search.get("tag") ?? undefined, branchId: search.get("branchId") ?? undefined,
  });
  const head = ["code", "fullName", "phone", "email", "gender", "birthDate", "address", "source", "status", "category", "tags", "branch", "owner", "createdAt", "lastVisitAt", "notes"];
  const lines = rows.map((r) =>
    [r.code, r.fullName, r.phone, r.email, r.gender, r.birthDate, r.address, r.source, r.status, r.category, r.tags, r.branch.name, r.owner?.fullName, r.createdAt, r.lastVisitAt, r.notes].map(esc).join(","),
  );
  return new Response("﻿" + [head.join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
