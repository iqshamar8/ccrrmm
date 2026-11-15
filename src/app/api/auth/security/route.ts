import { route } from "@/server/api";
import { securityOverview } from "@/server/services/session";

// 2FA status + the user's recent sign-in / security events.
export const GET = route(({ ctx }) => securityOverview(ctx));
