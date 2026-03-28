import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";

export const maxDuration = 120; // 2 min — AI generation + web search takes time

const BRIEFING_MODEL =
  process.env.BRIEFING_MODEL || "anthropic/claude-sonnet-4.6";

interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

async function sendBriefingAlert(embed: DiscordEmbed): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL_BRIEFING;
  if (!webhookUrl) {
    console.warn("[briefing] DISCORD_WEBHOOK_URL_BRIEFING not set");
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ ...embed, timestamp: new Date().toISOString() }],
      }),
    });

    if (!res.ok) {
      console.error(`[briefing] Discord failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[briefing] Discord error:",
      err instanceof Error ? err.message : "Unknown"
    );
    return false;
  }
}

// Discord embeds have a 4096 char limit for description
// Send multiple embeds if content is long
async function sendLongBriefing(
  title: string,
  sections: { name: string; content: string; color: number }[]
): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL_BRIEFING;
  if (!webhookUrl) return false;

  const embeds: DiscordEmbed[] = sections.map((s) => ({
    title: s.name,
    description: s.content.slice(0, 4090),
    color: s.color,
    timestamp: new Date().toISOString(),
  }));

  // Discord allows max 10 embeds per message
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `**${title}**`,
        embeds: embeds.slice(0, 10),
      }),
    });
    if (!res.ok) {
      console.error(`[briefing] Discord failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[briefing] Discord error:", err);
    return false;
  }
}

const today = () => {
  const d = new Date();
  return d.toISOString().split("T")[0];
};

const COLORS = {
  blue: 3447003,
  green: 3066993,
  orange: 15105570,
  purple: 10181046,
  red: 15158332,
};

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = today();

  try {
    // Generate all sections in parallel using AI
    const [worldNews, aiNews, businessDiscovery, wildCard] = await Promise.all([
      generateSection(
        "world-news",
        `You are a news curator for a Hong Kong-based entrepreneur. Today is ${date}.

Generate a concise news briefing with 4-5 of the most important stories from today/yesterday. Cover:
- 1-2 world/geopolitics stories that impact business
- 1-2 Hong Kong / Asia-Pacific stories
- 1 finance/markets story

For each story:
- Bold headline (max 80 chars)
- 1-line summary with why it matters to a HK business owner
- No URLs needed

Format as bullet points. Keep total under 1500 chars.`
      ),

      generateSection(
        "ai-tech",
        `You are an AI/tech news curator. Today is ${date}.

Generate 3-4 of the most significant AI and technology stories from the past 48 hours. Focus on:
- New AI model releases or major updates
- AI tools that could impact small business operations
- Tech industry moves (acquisitions, launches, shutdowns)
- AI regulation or policy changes

For each: bold headline + 1-line "why it matters for someone building AI products."
Keep total under 1200 chars.`
      ),

      generateSection(
        "business-discovery",
        `You are a business strategy advisor for a Hong Kong insurance agency leader who sells AI consulting to agencies. Today is ${date}.

Surface 2-3 ADJACENT business insights — ideas from OUTSIDE insurance that could apply to his business:
- A pricing model from SaaS/tech that insurance agencies could adopt
- A retention tactic from hospitality/restaurants/fitness that applies to client service
- A growth framework or mental model from a successful entrepreneur

These should be things he would NOT find in his normal reading. Be specific — name the company/person/framework.
Format: **Framework/Insight Name** — 2-3 sentence explanation + how it applies to selling AI to insurance agencies.
Keep under 1200 chars.`
      ),

      generateSection(
        "wild-card",
        `You are a cross-domain knowledge curator. Today is ${date}.

Surface 1-2 fascinating insights from fields COMPLETELY UNRELATED to business or technology:
- Health science / neuroscience / psychology research
- Historical patterns that repeat in modern business
- Scientific methodology that applies to decision-making
- Unusual cultural or sociological observations

The goal is serendipity — things that make someone think "I never would have connected that to my work."
For each: **Title** — 2-3 sentences. End with a "Connection:" line that links it to business/life.
Keep under 800 chars.`
      ),
    ]);

    // Send to Discord as multiple embeds
    const sent = await sendLongBriefing(
      `━━━ Daily Briefing — ${date} ━━━`,
      [
        {
          name: "🌏 World & HK News",
          content: worldNews,
          color: COLORS.blue,
        },
        {
          name: "🤖 AI & Tech",
          content: aiNews,
          color: COLORS.green,
        },
        {
          name: "💼 Business Discovery (Adjacent)",
          content: businessDiscovery,
          color: COLORS.orange,
        },
        {
          name: "🔬 Wild Card (Cross-Domain)",
          content: wildCard,
          color: COLORS.purple,
        },
      ]
    );

    if (!sent) {
      console.error("[briefing] Failed to send to Discord");
      return NextResponse.json(
        { error: "Discord delivery failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      date,
      sections: 4,
      message: "Briefing sent to Discord",
    });
  } catch (err) {
    console.error("[briefing] Generation failed:", err);

    // Send error notification to briefing channel
    await sendBriefingAlert({
      title: `❌ Briefing Failed — ${date}`,
      description: `Generation error: ${err instanceof Error ? err.message.slice(0, 300) : "Unknown error"}`,
      color: COLORS.red,
    });

    return NextResponse.json(
      { error: "Briefing generation failed" },
      { status: 500 }
    );
  }
}

async function generateSection(
  name: string,
  prompt: string
): Promise<string> {
  try {
    const { text } = await generateText({
      model: BRIEFING_MODEL as `${string}/${string}`,
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: 800,
    });
    return text || `*No ${name} content generated*`;
  } catch (err) {
    console.error(`[briefing] ${name} generation failed:`, err);
    return `*${name} generation failed — will retry next run*`;
  }
}
