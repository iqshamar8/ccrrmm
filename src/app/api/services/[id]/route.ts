import { route } from "@/server/api";
import { deleteService, updateService } from "@/server/services/catalog";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateService(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteService(ctx, params.id));
