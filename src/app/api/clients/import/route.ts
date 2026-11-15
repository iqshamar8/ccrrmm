import { route } from "@/server/api";
import { importClients } from "@/server/services/clients";

export const POST = route(({ ctx, body }) => importClients(ctx, (body as { rows?: unknown })?.rows));
