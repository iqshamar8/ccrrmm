import { route } from "@/server/api";
import { issueStock } from "@/server/services/inventory";

/** {type: ISSUE|WASTE, warehouseId, notes, lines[{itemId, quantity}]} */
export const POST = route(({ ctx, body }) => issueStock(ctx, body));
