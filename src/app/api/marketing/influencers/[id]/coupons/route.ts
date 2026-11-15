import { route } from "@/server/api";
import { setInfluencerCoupons } from "@/server/services/marketing";

export const PUT = route<{ id: string }>(({ ctx, params, body }) => setInfluencerCoupons(ctx, params.id, body));
