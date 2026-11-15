import { route } from "@/server/api";
import { listServiceMaterials, saveServiceMaterials } from "@/server/services/inventory";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => listServiceMaterials(ctx, params.id));
export const PUT = route<P>(({ ctx, params, body }) => saveServiceMaterials(ctx, params.id, body));
