import { route } from "@/server/api";
import { listEmployees } from "@/server/services/hr";

export const GET = route(({ ctx }) => listEmployees(ctx));
