import { route } from "@/server/api";
import { listCounts, startCount } from "@/server/services/inventory";

export const GET = route(({ ctx }) => listCounts(ctx));
export const POST = route(({ ctx, body }) => startCount(ctx, body));
