import { route } from "@/server/api";
import { getTenant, updateTenant } from "@/server/services/platform";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getTenant(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateTenant(ctx, params.id, body));
