import { route } from "@/server/api";
import { getCount, updateCount } from "@/server/services/inventory";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getCount(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateCount(ctx, params.id, body));
