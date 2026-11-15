import { route } from "@/server/api";
import { deleteClient, getClient, updateClient } from "@/server/services/clients";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getClient(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateClient(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteClient(ctx, params.id));
