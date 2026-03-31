import { NextResponse } from "next/server";

const DISCORD_WEBHOOK = process.env.DISCORD_AI_COSTS_WEBHOOK;
const AI_GATEWAY_KEY = process.env.AI_GATEWAY_API_KEY;

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!DISCORD_WEBHOOK) {
    return NextResponse.json({ error: "DISCORD_AI_COSTS_WEBHOOK not set" }, { status: 500 });
  }

  if (!AI_GATEWAY_KEY) {
    return NextResponse.json({ error: "AI_GATEWAY_API_KEY not set" }, { status: 500 });
  }

  try {
    // Fetch credit balance from AI Gateway
    const creditsRes = await fetch("https://ai-gateway.vercel.sh/v1/credits", {
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!creditsRes.ok) {
      throw new Error(`AI Gateway /credits returned ${creditsRes.status}`);
    }

    const credits = await creditsRes.json() as {
      balance: string;
      total_used: string;
    };

    const balance = parseFloat(credits.balance);
    const totalUsed = parseFloat(credits.total_used);

    // Determine alert level
    let color = 0x2ecc71; // green
    let status = "Healthy";
    if (balance < 5) {
      color = 0xe74c3c; // red
      status = "LOW BALANCE";
    } else if (balance < 20) {
      color = 0xf39c12; // yellow
      status = "Monitor";
    }

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    // Send Discord embed
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: "AI Gateway — Weekly Cost Report",
            color,
            fields: [
              {
                name: "Credit Balance",
                value: `$${balance.toFixed(2)}`,
                inline: true,
              },
              {
                name: "Total Used (All Time)",
                value: `$${totalUsed.toFixed(2)}`,
                inline: true,
              },
              {
                name: "Status",
                value: status,
                inline: true,
              },
              {
                name: "Active Models",
                value: [
                  "`deepseek/deepseek-chat` — AIA Knowledge Hub",
                  "`anthropic/claude-sonnet-4.6` — Financial CRM",
                ].join("\n"),
                inline: false,
              },
              {
                name: "Dashboard",
                value: "[View AI Gateway →](https://vercel.com/dorandas-projects/~/ai-gateway)",
                inline: false,
              },
            ],
            footer: {
              text: `Report generated ${now.toISOString().split("T")[0]}`,
            },
          },
        ],
      }),
    });

    return NextResponse.json({
      ok: true,
      balance: credits.balance,
      total_used: credits.total_used,
      status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron/ai-costs] Error:", msg);

    // Still try to notify Discord about the error
    if (DISCORD_WEBHOOK) {
      await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: "AI Gateway — Cost Report FAILED",
            color: 0xe74c3c,
            description: `Error: ${msg}`,
            footer: { text: new Date().toISOString() },
          }],
        }),
      }).catch(() => {});
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
