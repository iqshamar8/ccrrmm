import { route } from "@/server/api";
import { listTiers, saveTier } from "@/server/services/loyalty";

export const GET = route(({ ctx }) => listTiers(ctx));
export const POST = route(({ ctx, body }) => saveTier(ctx, null, body));
