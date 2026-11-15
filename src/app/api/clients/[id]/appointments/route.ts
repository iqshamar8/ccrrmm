import { route } from "@/server/api";
import { clientAppointments } from "@/server/services/appointments";

export const GET = route<{ id: string }>(({ ctx, params }) => clientAppointments(ctx, params.id));
