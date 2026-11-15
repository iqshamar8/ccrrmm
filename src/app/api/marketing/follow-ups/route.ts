import { route } from "@/server/api";
import { followUps, FOLLOWUP_KINDS } from "@/server/services/marketing";

export const GET = route(({ ctx, search }) => {
  const kind = (FOLLOWUP_KINDS as readonly string[]).includes(search.get("kind") ?? "") ? (search.get("kind") as (typeof FOLLOWUP_KINDS)[number]) : "inactive";
  return followUps(ctx, kind, { days: search.get("days") ? Number(search.get("days")) : undefined });
});
