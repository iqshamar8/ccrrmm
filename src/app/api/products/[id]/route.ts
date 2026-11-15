import { route } from "@/server/api";
import { saveProduct } from "@/server/services/billing";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveProduct(ctx, params.id, body));
