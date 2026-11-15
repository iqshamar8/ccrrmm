import { route } from "@/server/api";
import { listDocuments } from "@/server/services/inventory";

export const GET = route(({ ctx, search }) => listDocuments(ctx, { type: search.get("type") ?? undefined, warehouseId: search.get("warehouseId") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined }));
