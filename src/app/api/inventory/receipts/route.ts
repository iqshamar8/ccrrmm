import { route } from "@/server/api";
import { receiveStock } from "@/server/services/inventory";

export const POST = route(({ ctx, body }) => receiveStock(ctx, body));
