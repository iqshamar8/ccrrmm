import { route } from "@/server/api";
import { listInfluencers, saveInfluencer } from "@/server/services/marketing";

export const GET = route(({ ctx }) => listInfluencers(ctx));
export const POST = route(({ ctx, body }) => saveInfluencer(ctx, null, body));
