// src/lib/discord.ts

interface DiscordEmbed {
  title: string;
  description: string;
  color: number; // decimal: green=3066993, yellow=16776960, red=15158332
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

const COLORS = {
  green: 3066993,
  yellow: 16776960,
  red: 15158332,
} as const;

interface SendOptions {
  /**
   * If true, route to DISCORD_WEBHOOK_URGENT_URL (#aia-alerts-urgent channel)
   * and prepend @here mention so it pings the phone. Falls back to default
   * webhook if the urgent URL is not configured.
   */
  urgent?: boolean;
}

/**
 * Send a Discord webhook message. Fails silently — never throws.
 * Error messages are sanitized to prevent leaking secrets.
 *
 * Two-tier routing:
 *  - urgent: true  → DISCORD_WEBHOOK_URGENT_URL (with @here)
 *  - urgent: false → DISCORD_WEBHOOK_URL (info channel, no mention)
 */
export async function sendDiscordAlert(
  embed: DiscordEmbed,
  options: SendOptions = {}
): Promise<boolean> {
  const { urgent = false } = options;

  const urgentUrl = process.env.DISCORD_WEBHOOK_URGENT_URL;
  const infoUrl = process.env.DISCORD_WEBHOOK_URL;

  // Pick channel: urgent → urgent webhook (fallback to info), otherwise info
  const webhookUrl = urgent ? urgentUrl || infoUrl : infoUrl;

  if (!webhookUrl) {
    console.warn(
      `[discord] No webhook URL set (urgent=${urgent}), skipping alert`
    );
    return false;
  }

  // @here mention only when we actually hit the urgent channel
  const content = urgent && urgentUrl ? "@here" : undefined;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(content ? { content, allowed_mentions: { parse: ["everyone"] } } : {}),
        embeds: [{ ...embed, timestamp: embed.timestamp || new Date().toISOString() }],
      }),
    });

    if (!res.ok) {
      console.error(`[discord] Webhook failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[discord] Webhook error:", err instanceof Error ? err.message : "Unknown");
    return false;
  }
}

/**
 * Sanitize error messages before sending to Discord.
 * Strips connection strings, API keys, and long stack traces.
 */
export function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg
    .replace(/postgresql?:\/\/[^\s]+/gi, "[DB_URL_REDACTED]")
    .replace(/sk-[a-zA-Z0-9]+/g, "[API_KEY_REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]")
    .slice(0, 500); // Cap at 500 chars
}

export { COLORS };
export type { DiscordEmbed };
