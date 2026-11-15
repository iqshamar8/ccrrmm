import { route } from "@/server/api";
import { transferStock } from "@/server/services/inventory";

export const POST = route(({ ctx, body }) => transferStock(ctx, body));
