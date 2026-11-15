import { route } from "@/server/api";
import { listLeaves, requestLeave } from "@/server/services/hr";

export const GET = route(({ ctx, search }) => listLeaves(ctx, { status: search.get("status") ?? undefined }));
export const POST = route(({ ctx, body }) => requestLeave(ctx, body));
