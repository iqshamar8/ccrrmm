import { route } from "@/server/api";
import { deleteAppointment, updateAppointment } from "@/server/services/appointments";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateAppointment(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteAppointment(ctx, params.id));
