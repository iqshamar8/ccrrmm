import { route } from "@/server/api";
import { removeMember } from "@/server/services/corporate";

export const DELETE = route<{ memberId: string }>(({ ctx, params }) => removeMember(ctx, params.memberId));
