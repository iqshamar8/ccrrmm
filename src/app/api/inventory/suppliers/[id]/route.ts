import { route } from "@/server/api";
import { saveSupplier } from "@/server/services/inventory";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveSupplier(ctx, params.id, body));
