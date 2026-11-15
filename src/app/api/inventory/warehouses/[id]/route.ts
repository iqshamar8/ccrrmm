import { route } from "@/server/api";
import { saveWarehouse } from "@/server/services/inventory";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveWarehouse(ctx, params.id, body));
