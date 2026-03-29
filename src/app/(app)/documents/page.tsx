import { createClient } from "@/lib/supabase/server";
import { DocumentsView } from "./documents-view";
import type { UserRole } from "@/lib/types";

export default async function DocumentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  const [docsResult, profileResult] = await Promise.all([
    supabase
      .from("documents")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (docsResult.error) console.error("[documents] Failed to fetch documents:", docsResult.error);
  if (profileResult.error) console.error("[documents] Failed to fetch profile:", profileResult.error);

  const documents = docsResult.data;
  const profile = profileResult.data;

  const userRole = (profile?.role || "agent") as UserRole;

  return <DocumentsView documents={documents ?? []} userRole={userRole} />;
}
