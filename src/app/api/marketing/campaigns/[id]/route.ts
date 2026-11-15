import { route } from "@/server/api";
import { getCampaign, saveCampaign } from "@/server/services/marketing";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getCampaign(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => saveCampaign(ctx, params.id, body));
