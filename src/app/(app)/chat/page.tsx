import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ChatView } from "./chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: conversations, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) console.error("[chat] conversations query error:", error);

  return <ChatView conversations={conversations ?? []} />;
}
