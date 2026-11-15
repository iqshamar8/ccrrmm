import { route } from "@/server/api";
import { savePO } from "@/server/services/inventory";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => savePO(ctx, params.id, body));
