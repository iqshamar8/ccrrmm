import { route } from "@/server/api";
import { listOffers, saveOffer } from "@/server/services/marketing";

export const GET = route(({ ctx }) => listOffers(ctx));
export const POST = route(({ ctx, body }) => saveOffer(ctx, null, body));
