import { route } from "@/server/api";
import { setReviewStatus } from "@/server/services/reviews";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setReviewStatus(ctx, params.id, body));
