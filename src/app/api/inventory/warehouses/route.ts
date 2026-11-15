import { route } from "@/server/api";
import { listWarehouses, saveWarehouse } from "@/server/services/inventory";

export const GET = route(({ ctx }) => listWarehouses(ctx));
export const POST = route(({ ctx, body }) => saveWarehouse(ctx, null, body));
