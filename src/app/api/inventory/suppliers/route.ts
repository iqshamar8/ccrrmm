import { route } from "@/server/api";
import { listSuppliers, saveSupplier } from "@/server/services/inventory";

export const GET = route(({ ctx }) => listSuppliers(ctx));
export const POST = route(({ ctx, body }) => saveSupplier(ctx, null, body));
