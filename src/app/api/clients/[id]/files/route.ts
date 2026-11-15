import { NextResponse } from "next/server";
import { rawRoute, route } from "@/server/api";
import { badRequest } from "@/server/errors";
import { listFiles, uploadFile } from "@/server/services/files";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => listFiles(ctx, params.id));

export const POST = rawRoute<P>(async ({ ctx, req, params }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) throw badRequest("No file uploaded");
  const f = await uploadFile(ctx, params.id, {
    category: String(form.get("category") ?? ""),
    note: form.get("note") ? String(form.get("note")) : null,
    surgeryId: form.get("surgeryId") ? String(form.get("surgeryId")) : null,
    reviewId: form.get("reviewId") ? String(form.get("reviewId")) : null,
    name: file.name,
    data: Buffer.from(await file.arrayBuffer()),
  });
  return NextResponse.json({ data: f });
});
