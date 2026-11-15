import { route } from "@/server/api";
import { launchCampaign } from "@/server/services/marketing";

export const POST = route<{ id: string }>(({ ctx, params, body }) => launchCampaign(ctx, params.id, body));
