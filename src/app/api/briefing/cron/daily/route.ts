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

// Discord limits: 4096 chars per embed description, 6000 total chars across embeds per message
// Split into multiple messages if needed
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

  // Batch embeds so total description chars stay under 5800 (buffer for titles/metadata)
  const batches: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentChars = 0;

  for (const embed of embeds) {
    const embedChars = (embed.title?.length || 0) + (embed.description?.length || 0);
    if (current.length > 0 && currentChars + embedChars > 5800) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(embed);
    currentChars += embedChars;
  }
  if (current.length > 0) batches.push(current);

  try {
    for (let i = 0; i < batches.length; i++) {
      const content = i === 0
        ? `**${title}**`
        : `**${title}** (${i + 1}/${batches.length})`;
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, embeds: batches[i] }),
      });
      if (!res.ok) {
        console.error(`[briefing] Discord failed on batch ${i + 1}: ${res.status}`);
        return false;
      }
      // Small delay between messages to respect Discord rate limits
      if (i < batches.length - 1) await new Promise((r) => setTimeout(r, 500));
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
    // Fetch real news via Brave Search (parallel)
    const [worldResults, hkResults, aiResults, bizResults] = await Promise.all([
      braveSearch("world news today important", 5),
      braveSearch("Hong Kong news today Asia Pacific", 5),
      braveSearch("AI artificial intelligence news today", 5),
      braveSearch("business strategy growth tactic startup SaaS pricing retention", 5),
    ]);

    // Generate all sections in parallel using AI + real search results
    const [worldNews, aiNews, businessDiscovery, wildCard] = await Promise.all([
      generateSection(
        "world-news",
        `You are a news curator for a Hong Kong-based entrepreneur. Today is ${date}.

Here are real news search results from today:

WORLD NEWS:
${worldResults || "No search results available"}

HONG KONG / ASIA NEWS:
${hkResults || "No search results available"}

From these results, pick the 4-5 most important stories and rewrite as a concise briefing:
- 1-2 world/geopolitics stories that impact business
- 1-2 Hong Kong / Asia-Pacific stories
- 1 finance/markets story

For each story:
- Bold headline as a markdown link: **[Headline](source_url)**
- 1-line summary with why it matters to a HK business owner

IMPORTANT: Include the source URL from the search results as a markdown link in each headline. This lets the reader click through to the full article.
If search results are empty, use your knowledge of current events (no links needed). Keep total under 2000 chars.`
      ),

      generateSection(
        "ai-tech",
        `You are an AI/tech news curator. Today is ${date}.

Here are real AI news search results from today:
${aiResults || "No search results available"}

From these results, pick 3-4 of the most significant stories and rewrite concisely. Focus on:
- New AI model releases or major updates
- AI tools that could impact small business operations
- Tech industry moves (acquisitions, launches, shutdowns)

For each: **[Headline](source_url)** + 1-line "why it matters for someone building AI products."
IMPORTANT: Include the source URL from the search results as a markdown link in each headline.
If search results are empty, use your knowledge (no links needed). Keep total under 1500 chars.`
      ),

      generateSection(
        "business-discovery",
        `You are a business strategy advisor for a Hong Kong insurance agency leader who sells AI consulting to agencies. Today is ${date}.

Here are real business/strategy articles from today:
${bizResults || "No search results available"}

From these results, pick 2-3 insights that are ADJACENT to insurance — ideas from OTHER industries that could apply to his business. Look for:
- A pricing model, retention tactic, or growth hack from SaaS/tech/hospitality/fitness
- A framework or strategy a company used that insurance agencies could steal
- Something he would NOT find in his normal insurance reading

For each: **[Insight/Framework Name](source_url)** — 2-3 sentence explanation + how it applies to selling AI to insurance agencies.
IMPORTANT: Include the source URL from the search results as a markdown link.
If search results are empty, use your knowledge (no links needed). Keep under 1500 chars.`
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

async function braveSearch(query: string, count = 5): Promise<string> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return "";

  try {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
      freshness: "pd", // past day
    });
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );
    if (!res.ok) {
      console.error(`[briefing] Brave search failed: ${res.status}`);
      return "";
    }
    const data = await res.json();
    const results = (data.web?.results || [])
      .slice(0, count)
      .map(
        (r: { title: string; description: string; url: string }) =>
          `- **${r.title}**: ${r.description}\n  Source: ${r.url}`
      )
      .join("\n");
    return results;
  } catch (err) {
    console.error("[briefing] Brave search error:", err);
    return "";
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
      maxOutputTokens: 1200,
    });
    return text || `*No ${name} content generated*`;
  } catch (err) {
    console.error(`[briefing] ${name} generation failed:`, err);
    return `*${name} generation failed — will retry next run*`;
  }
}
