import { route } from "@/server/api";
import { decideLeave } from "@/server/services/hr";

export const POST = route<{ id: string }>(({ ctx, params, body }) => decideLeave(ctx, params.id, body));
