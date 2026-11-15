import { route } from "@/server/api";
import { createManualJournal, listJournals } from "@/server/services/accounting";

export const GET = route(({ ctx, search }) => listJournals(ctx, { source: search.get("source") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, accountId: search.get("accountId") ?? undefined, search: search.get("q") ?? undefined, page: Number(search.get("page") ?? 1) }));
export const POST = route(({ ctx, body }) => createManualJournal(ctx, body));
