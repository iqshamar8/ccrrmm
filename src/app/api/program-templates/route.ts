import { route } from "@/server/api";
import { createTemplate, listTemplates } from "@/server/services/programs";

export const GET = route(({ ctx }) => listTemplates(ctx));
export const POST = route(({ ctx, body }) => createTemplate(ctx, body));
