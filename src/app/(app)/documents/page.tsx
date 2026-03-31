import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { DocumentsView } from "./documents-view";
import type { UserRole } from "@/lib/types";

export default async function DocumentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const adminDb = createAdminClient();
  const [docsResult, profileResult] = await Promise.all([
    adminDb
      .from("documents")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    adminDb.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  if (docsResult.error) console.error("[documents] Failed to fetch documents:", docsResult.error);
  if (profileResult.error) console.error("[documents] Failed to fetch profile:", profileResult.error);

  const documents = docsResult.data;
  const profile = profileResult.data;

  const userRole = (profile?.role || "agent") as UserRole;

  return <DocumentsView documents={documents ?? []} userRole={userRole} />;
}
