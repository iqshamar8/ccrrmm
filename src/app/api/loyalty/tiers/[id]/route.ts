import { route } from "@/server/api";
import { deleteTier, saveTier } from "@/server/services/loyalty";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => saveTier(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteTier(ctx, params.id));
