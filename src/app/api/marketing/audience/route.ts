import { route } from "@/server/api";
import { previewAudience } from "@/server/services/marketing";

/** body = audience filter → {count, sample} */
export const POST = route(({ ctx, body }) => previewAudience(ctx, body));
