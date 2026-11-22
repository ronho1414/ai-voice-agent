import { NextRequest } from "next/server";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { listAppointments, updateAppointmentStatus } from "@/lib/platform/store";
import type { AppointmentStatus } from "@/lib/platform/types";

export async function GET(request: NextRequest) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) {
    return Response.json({ error: "No organization associated" }, { status: 400 });
  }

  try {
    const appointments = await listAppointments(orgId);
    return Response.json({ appointments }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load appointments" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) {
    return Response.json({ error: "No organization associated" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as { appointmentId?: string; status?: AppointmentStatus };
    if (!body.appointmentId || !body.status) {
      return Response.json({ error: "Missing appointmentId or status" }, { status: 400 });
    }

    const updated = await updateAppointmentStatus(orgId, body.appointmentId, body.status);
    return Response.json({ success: true, appointment: updated });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update appointment" },
      { status: 400 }
    );
  }
}
