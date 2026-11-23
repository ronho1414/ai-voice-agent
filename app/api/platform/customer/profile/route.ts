import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { getOrganizationById, updateOrganization } from "@/lib/platform/store";

async function handleGET(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) return Response.json({ error: "No organization associated" }, { status: 400 });

  try {
    const org = await getOrganizationById(orgId);
    if (!org) return Response.json({ error: "Organization not found" }, { status: 404 });
    return Response.json({ profile: org }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load profile" },
      { status: 500 }
    );
  }
}

async function handlePATCH(request: Request) {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;

  const orgId = auth.organizationId;
  if (!orgId) return Response.json({ error: "No organization associated" }, { status: 400 });

  try {
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.email !== undefined) updates.email = body.email;
    if (body.address !== undefined) updates.address = body.address;
    if (body.opening_hours !== undefined) updates.opening_hours = body.opening_hours;

    const updated = await updateOrganization(orgId, updates);
    return Response.json({ success: true, profile: updated });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update profile" },
      { status: 400 }
    );
  }
}

export const GET = withPlatformRequest(handleGET);
export const PATCH = withPlatformRequest(handlePATCH);
