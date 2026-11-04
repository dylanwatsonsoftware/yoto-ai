type Request = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Response = {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(value: unknown): void;
};

declare const process: { env: Record<string, string | undefined> };

const RETENTION_SECONDS = 60 * 60 * 24 * 180;
const MAX_FEEDBACK_ITEMS = 250;

function redisConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function readFeedback() {
  const config = redisConfig();
  if (!config) throw new Error("Feedback storage is not configured");
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify([["LRANGE", "myo:feedback", 0, MAX_FEEDBACK_ITEMS - 1]]),
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error("Feedback storage request failed");
  const [result] = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (result?.error || !Array.isArray(result?.result)) {
    throw new Error("Feedback storage response was invalid");
  }
  return result.result.flatMap((entry) => {
    try {
      const item = JSON.parse(String(entry)) as { message?: unknown; submittedAt?: unknown };
      return typeof item.message === "string" && typeof item.submittedAt === "string"
        ? [{ message: item.message, submittedAt: item.submittedAt }]
        : [];
    } catch {
      return [];
    }
  });
}

export default async function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") {
    const adminToken = process.env.FEEDBACK_ADMIN_TOKEN;
    const authorization = request.headers.authorization;
    if (!adminToken) return response.status(503).json({ available: false });
    if (typeof authorization !== "string" || authorization !== `Bearer ${adminToken}`) {
      return response.status(401).json({ available: false });
    }
    try {
      return response.status(200).json({ items: await readFeedback() });
    } catch {
      return response.status(503).json({ available: false });
    }
  }
  if (request.method !== "POST") return response.status(405).json({ accepted: false });

  const origin = request.headers.origin;
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") {
    return response.status(403).json({ accepted: false });
  }
  try {
    if (new URL(origin).host !== host) return response.status(403).json({ accepted: false });
  } catch {
    return response.status(403).json({ accepted: false });
  }

  const body = request.body as { message?: unknown; website?: unknown } | undefined;
  if (typeof body?.website === "string" && body.website.trim()) {
    return response.status(202).json({ accepted: true });
  }
  if (typeof body?.message !== "string") return response.status(400).json({ accepted: false });
  const message = body.message.replace(/\r\n?/g, "\n").trim();
  if (
    message.length < 5 ||
    message.length > 1000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)
  ) {
    return response.status(400).json({ accepted: false });
  }

  const config = redisConfig();
  if (!config) return response.status(503).json({ accepted: false });

  try {
    const saved = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([
        ["LPUSH", "myo:feedback", JSON.stringify({ message, submittedAt: new Date().toISOString() })],
        ["LTRIM", "myo:feedback", 0, MAX_FEEDBACK_ITEMS - 1],
        ["EXPIRE", "myo:feedback", RETENTION_SECONDS]
      ]),
      signal: AbortSignal.timeout(2500)
    });
    if (!saved.ok) throw new Error("Feedback storage request failed");
    const results = (await saved.json()) as Array<{ error?: string }>;
    if (results.some((item) => item.error)) throw new Error("Feedback storage command failed");
    return response.status(202).json({ accepted: true });
  } catch {
    return response.status(503).json({ accepted: false });
  }
}
