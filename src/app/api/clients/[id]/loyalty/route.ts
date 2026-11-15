import { route } from "@/server/api";
import { adjustPoints, clientLoyalty } from "@/server/services/loyalty";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => clientLoyalty(ctx, params.id));
/** Manual adjustment {points, note} */
export const POST = route<P>(({ ctx, params, body }) => adjustPoints(ctx, params.id, body));
