import { createClient } from "@/lib/supabase/server";
import { DocumentsView } from "./documents-view";
import type { UserRole } from "@/lib/types";

export default async function DocumentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: documents }, { data: profile }] = await Promise.all([
    supabase
      .from("documents")
      .select("*")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false }),
    user
      ? supabase.from("profiles").select("role").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
  ]);

  const userRole = (profile?.role || "agent") as UserRole;

  return <DocumentsView documents={documents ?? []} userRole={userRole} />;
}
