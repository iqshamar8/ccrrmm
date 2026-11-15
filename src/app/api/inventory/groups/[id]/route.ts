import { route } from "@/server/api";
import { saveGroup } from "@/server/services/inventory";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveGroup(ctx, params.id, body));
