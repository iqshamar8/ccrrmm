import { route } from "@/server/api";
import { addInteraction, listInteractions } from "@/server/services/clients";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => listInteractions(ctx, params.id));
export const POST = route<P>(({ ctx, params, body }) => addInteraction(ctx, params.id, body));
