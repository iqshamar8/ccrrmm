import { route } from "@/server/api";
import { enableTotp } from "@/server/services/session";

// Enrolment step 2: confirm a code; returns the one-time recovery codes.
export const POST = route(({ ctx, body }) => enableTotp(ctx, body));
