import { route } from "@/server/api";
import { startTotp } from "@/server/services/session";

// Enrolment step 1: new (inactive) secret + otpauth:// URI for the authenticator app.
export const POST = route(({ ctx }) => startTotp(ctx));
