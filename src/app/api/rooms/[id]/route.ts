import { route } from "@/server/api";
import { deleteRoom, updateRoom } from "@/server/services/catalog";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateRoom(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteRoom(ctx, params.id));
