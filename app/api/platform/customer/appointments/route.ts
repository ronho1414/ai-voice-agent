import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { listAppointments, updateAppointmentStatus, deleteAppointment } from "@/lib/platform/store";
import type { AppointmentStatus } from "@/lib/platform/types";

async function handleGET(request: Request) {
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

async function handlePATCH(request: Request) {
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
    if (typeof body.appointmentId !== "string" || !["pending", "confirmed", "rejected", "cancelled", "completed"].includes(body.status)) {
      return Response.json({ error: "預約狀態不正確" }, { status: 400 });
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

async function handleDELETE(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) {
    return Response.json({ error: "No organization associated" }, { status: 400 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const appointmentId = searchParams.get("appointmentId");
    if (!appointmentId) {
      return Response.json({ error: "Missing appointmentId" }, { status: 400 });
    }

    await deleteAppointment(orgId, appointmentId);
    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to delete appointment" },
      { status: 400 }
    );
  }
}

export const GET = withPlatformRequest(handleGET);
export const PATCH = withPlatformRequest(handlePATCH);
export const DELETE = withPlatformRequest(handleDELETE);
