import { route } from "@/server/api";
import { addInfluencerAdjustment } from "@/server/services/marketing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => addInfluencerAdjustment(ctx, params.id, body));
