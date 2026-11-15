import { route } from "@/server/api";
import { updateSession } from "@/server/services/programs";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => updateSession(ctx, params.id, body));
