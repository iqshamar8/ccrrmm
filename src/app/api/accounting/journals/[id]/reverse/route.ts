import { route } from "@/server/api";
import { reverseJournal } from "@/server/services/accounting";

export const POST = route<{ id: string }>(({ ctx, params, body }) => reverseJournal(ctx, params.id, body));
