import { route } from "@/server/api";
import { createService } from "@/server/services/catalog";

export const POST = route(({ ctx, body }) => createService(ctx, body));
