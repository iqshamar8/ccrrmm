import { route } from "@/server/api";
import { setCommissionStatus } from "@/server/services/commissions";

export const POST = route(({ ctx, body }) => setCommissionStatus(ctx, body));
