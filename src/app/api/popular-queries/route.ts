import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data } = await supabase
    .from("popular_queries")
    .select("query_text, count")
    .order("count", { ascending: false })
    .limit(6);

  return NextResponse.json(data || []);
}
