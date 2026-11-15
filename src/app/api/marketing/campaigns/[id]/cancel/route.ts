import { route } from "@/server/api";
import { cancelCampaign } from "@/server/services/marketing";

export const POST = route<{ id: string }>(({ ctx, params }) => cancelCampaign(ctx, params.id));
