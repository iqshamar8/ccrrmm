import { route } from "@/server/api";
import { disableTotp } from "@/server/services/session";

// Turning 2FA off requires the current password.
export const POST = route(({ ctx, body }) => disableTotp(ctx, body));
