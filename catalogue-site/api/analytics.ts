import albumIndex from "../public/catalogue/album-ids.json";

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

const RETENTION_SECONDS = 60 * 60 * 24 * 90;
const allowedEvents = new Set(["favorite", "open", "search"]);
const albumIds = new Set(albumIndex.map((album) => album.id));

function normalizeSearch(value: string) {
  return value.normalize("NFKD").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function redisConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL)?.replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisPipeline(commands: unknown[][]): Promise<unknown[]> {
  const config = redisConfig();
  if (!config) throw new Error("Analytics storage is not configured");
  const response = await fetch(`${config.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(2500)
  });
  if (!response.ok) throw new Error("Analytics storage request failed");
  const results = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (results.some((item) => item.error)) throw new Error("Analytics storage command failed");
  return results.map((item) => item.result);
}

function keyFor(date: string, event: string, country: string, dimension = "items") {
  return `myo:${dimension}:${date}:${event}:${country}`;
}

function currentWeek(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addScores(target: Map<string, number>, rows: unknown) {
  if (!Array.isArray(rows)) return;
  for (let index = 0; index + 1 < rows.length; index += 2) {
    const member = String(rows[index]);
    const score = Number(rows[index + 1]);
    if (Number.isFinite(score)) target.set(member, (target.get(member) ?? 0) + score);
  }
}

export default async function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  const config = redisConfig();
  if (!config) return response.status(503).json({ available: false });

  try {
    if (request.method === "POST") {
      const origin = request.headers.origin;
      const host = request.headers["x-forwarded-host"] ?? request.headers.host;
      if (typeof origin !== "string" || typeof host !== "string" || new URL(origin).host !== host) {
        return response.status(403).json({ available: false });
      }
      const body = request.body as { event?: unknown; value?: unknown } | undefined;
      const event = typeof body?.event === "string" ? body.event : "";
      if (!allowedEvents.has(event) || typeof body?.value !== "string" || body.value.length > 120) {
        return response.status(400).json({ available: false });
      }
      const value = body.value.normalize("NFKC").trim().replace(/\s+/g, " ");
      if (!value || /[\u0000-\u001f]/.test(value)) {
        return response.status(400).json({ available: false });
      }
      if (event !== "search" && !albumIds.has(value)) {
        return response.status(400).json({ available: false });
      }
      if (event === "search") {
        const query = normalizeSearch(value);
        if (query.length < 2 || !albumIndex.some((album) => normalizeSearch(album.searchable).includes(query))) {
          return response.status(400).json({ available: false });
        }
      }
      const metricValue = event === "search" ? normalizeSearch(value) : value;
      const countryHeader = request.headers["x-vercel-ip-country"];
      const country = typeof countryHeader === "string" && /^[A-Z]{2}$/.test(countryHeader)
        ? countryHeader
        : "unknown";
      const week = currentWeek();
      const commands: unknown[][] = [];
      const key = keyFor(week, event, "all");
      commands.push(["ZINCRBY", key, 1, metricValue], ["EXPIRE", key, RETENTION_SECONDS]);
      const countryKey = keyFor(week, "all", "all", "countries");
      commands.push(["ZINCRBY", countryKey, 1, country], ["EXPIRE", countryKey, RETENTION_SECONDS]);
      await redisPipeline(commands);
      return response.status(202).json({ accepted: true });
    }

    if (request.method !== "GET") return response.status(405).json({ available: false });
    const week = currentWeek();
    const commands: unknown[][] = [
      ["ZREVRANGE", keyFor(week, "favorite", "all"), 0, 19, "WITHSCORES"],
      ["ZREVRANGE", keyFor(week, "open", "all"), 0, 19, "WITHSCORES"],
      ["ZREVRANGE", keyFor(week, "search", "all"), 0, 19, "WITHSCORES"],
      ["ZREVRANGE", keyFor(week, "all", "all", "countries"), 0, 99, "WITHSCORES"]
    ];
    const results = await redisPipeline(commands);
    const totals = { favorites: new Map<string, number>(), opens: new Map<string, number>(), searches: new Map<string, number>(), countries: new Map<string, number>() };
    addScores(totals.favorites, results[0]);
    addScores(totals.opens, results[1]);
    addScores(totals.searches, results[2]);
    addScores(totals.countries, results[3]);
    const top = (scores: Map<string, number>, minimum = 3) => [...scores]
      .sort((left, right) => right[1] - left[1])
      .filter(([, count]) => count >= minimum)
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return response.status(200).json({
      available: true,
      favorites: top(totals.favorites),
      opens: top(totals.opens),
      searches: top(totals.searches),
      countries: top(totals.countries, 5)
    });
  } catch {
    return response.status(503).json({ available: false });
  }
}
