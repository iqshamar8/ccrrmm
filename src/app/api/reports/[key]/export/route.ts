import { rawRoute } from "@/server/api";
import { forbidden } from "@/server/errors";
import { runReport } from "@/server/services/reports";
import { buildCsv, buildXlsx, type Cell } from "@/server/xlsx";

/** GET /api/reports/:key/export?format=xlsx|csv&from=&to=&branchId=&days=&lang= (reports.export) */
export const GET = rawRoute<{ key: string }>(async ({ ctx, params, search }) => {
  if (!ctx.permissions.has("reports.export")) throw forbidden("You don't have permission to export reports");
  const lang = search.get("lang") === "en" ? "en" : "ar";
  const r = await runReport(ctx, params.key, { from: search.get("from"), to: search.get("to"), branchId: search.get("branchId"), days: search.get("days"), lang });
  const header = r.columns.map((c) => (lang === "en" ? c.en : c.ar));
  const cell = (v: unknown, type?: string): Cell => {
    if (v === null || v === undefined) return null;
    if (type === "date" && v) return new Date(String(v)).toISOString().slice(0, 10);
    if (typeof v === "number" || (typeof v === "string" && type && type !== "text" && v !== "" && !isNaN(Number(v)))) return Number(v);
    return String(v);
  };
  const rows = r.rows.map((row) => r.columns.map((c) => cell(row[c.key], c.type)));
  if (r.totals) rows.push(r.columns.map((c, i) => (i === 0 ? (lang === "en" ? "Total" : "الإجمالي") : cell(r.totals![c.key], c.type))));
  const title = `${lang === "en" ? r.title.en : r.title.ar} — ${r.from.toISOString().slice(0, 10)} → ${new Date(+r.to - 1).toISOString().slice(0, 10)}`;
  const name = `${r.key}-${new Date().toISOString().slice(0, 10)}`;
  if (search.get("format") === "csv") {
    return new Response(buildCsv(header, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
  }
  const file = buildXlsx({ sheet: lang === "en" ? r.title.en : r.title.ar, header, rows, rtl: lang === "ar", title });
  return new Response(file, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" },
  });
});
