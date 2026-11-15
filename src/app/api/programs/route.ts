import { route } from "@/server/api";
import { assignProgram, listPrograms } from "@/server/services/programs";

export const GET = route(({ ctx, search }) =>
  listPrograms(ctx, { status: search.get("status") ?? undefined, stalled: search.get("stalled") === "1", clientId: search.get("clientId") ?? undefined, search: search.get("q") ?? undefined }),
);
export const POST = route(({ ctx, body }) => assignProgram(ctx, body));
