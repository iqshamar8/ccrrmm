import { route } from "@/server/api";
import { getSurgery, updateSurgery } from "@/server/services/surgeries";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getSurgery(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateSurgery(ctx, params.id, body));
