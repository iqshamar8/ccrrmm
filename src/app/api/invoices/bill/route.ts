import { route } from "@/server/api";
import { billSource } from "@/server/services/billing";

/** Create a draft invoice from an appointment / program / subscription / surgery */
export const POST = route(({ ctx, body }) => billSource(ctx, body));
