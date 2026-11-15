import { route } from "@/server/api";
import { setPOStatus } from "@/server/services/inventory";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setPOStatus(ctx, params.id, body));
