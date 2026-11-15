import { route } from "@/server/api";
import { loyaltyOverview } from "@/server/services/loyalty";

export const GET = route(({ ctx }) => loyaltyOverview(ctx));
