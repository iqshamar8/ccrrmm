import { route } from "@/server/api";
import { saveShifts } from "@/server/services/hr";

export const PUT = route<{ id: string }>(({ ctx, params, body }) => saveShifts(ctx, params.id, body));
