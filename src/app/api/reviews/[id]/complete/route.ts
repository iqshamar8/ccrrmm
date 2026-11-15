import { route } from "@/server/api";
import { completeReview } from "@/server/services/reviews";

export const POST = route<{ id: string }>(({ ctx, params, body }) => completeReview(ctx, params.id, body));
