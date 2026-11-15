import { route } from "@/server/api";
import { recordSession } from "@/server/services/programs";

export const POST = route<{ id: string }>(({ ctx, params, body }) => recordSession(ctx, params.id, body));
