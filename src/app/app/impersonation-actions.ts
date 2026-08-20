"use server";

import { redirect } from "next/navigation";
import { recordAdminAction } from "@/lib/admin/audit";
import { endImpersonation } from "@/lib/admin/impersonation";
import { adminUrl } from "@/lib/env";

/**
 * Ends an impersonation from the tenant app: clears the app-host cookie, closes
 * the DB session, and returns the admin to the console (cross-origin, so a full
 * navigation). Recorded to the audit trail.
 */
export async function stopViewing() {
  const ended = await endImpersonation();
  if (ended) {
    await recordAdminAction({
      actorUserId: ended.adminUserId,
      action: "admin.impersonation_ended",
      organizationId: ended.organizationId,
    });
  }
  redirect(adminUrl("/"));
}
