import { route } from "@/server/api";
import { getReview, updateReview } from "@/server/services/reviews";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getReview(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateReview(ctx, params.id, body));
