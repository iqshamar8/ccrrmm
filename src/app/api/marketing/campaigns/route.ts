import { route } from "@/server/api";
import { listCampaigns, saveCampaign } from "@/server/services/marketing";

export const GET = route(({ ctx }) => listCampaigns(ctx));
export const POST = route(({ ctx, body }) => saveCampaign(ctx, null, body));
