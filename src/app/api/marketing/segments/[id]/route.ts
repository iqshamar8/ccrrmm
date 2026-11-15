import { route } from "@/server/api";
import { deleteSegment, saveSegment } from "@/server/services/marketing";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => saveSegment(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteSegment(ctx, params.id));
