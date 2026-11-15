import { route } from "@/server/api";
import { createReview, listReviews } from "@/server/services/reviews";

export const GET = route(({ ctx, search }) =>
  listReviews(ctx, {
    scope: search.get("scope") ?? undefined, status: search.get("status") ?? undefined, doctorId: search.get("doctorId") ?? undefined,
    clientId: search.get("clientId") ?? undefined, surgeryId: search.get("surgeryId") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => createReview(ctx, body));
