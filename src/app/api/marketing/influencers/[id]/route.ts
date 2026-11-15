import { route } from "@/server/api";
import { getInfluencer, saveInfluencer } from "@/server/services/marketing";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getInfluencer(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => saveInfluencer(ctx, params.id, body));
