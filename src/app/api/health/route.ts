import { generateText } from "ai";
import { getServerEnv, describeServerEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/api-guard";
import { createResultCache } from "@/lib/cache";
import { getModelChain } from "@/lib/llm/gemini";

export const dynamic = "force-dynamic";

type ModelProbe = {
  id: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

type HealthBody = {
  status: "ok" | "unavailable" | "misconfigured";
  config: ReturnType<typeof describeServerEnv>;
  models: ModelProbe[];
  answeredBy: string | null;
  checkedAt: string;
};

/**
 * This is a model-calling endpoint too, and was the one that got missed: it
 * is auto-fired by SystemStatus on every homepage load, with no rate limit
 * and no cache, so every visit spent a real, billable Gemini call -- and
 * anyone could hit it directly, repeatedly, for free, against the same quota
 * the rate limiter exists to protect. A short-lived cache is the right fix
 * for the common case (repeat homepage loads shouldn't each cost a call);
 * the shared limiter below is the backstop for direct abuse past the cache
 * window, same one /api/simplify and /api/ask use, since it protects one
 * shared resource regardless of which route asks.
 */
const HEALTH_CACHE_KEY = "health";
const HEALTH_CACHE_TTL_MS = 30_000;
const healthCache = createResultCache<HealthBody>({ maxEntries: 1, ttlMs: HEALTH_CACHE_TTL_MS });

async function probeModels(): Promise<HealthBody> {
  const config = describeServerEnv();

  if (!config.ok) {
    return { status: "misconfigured", config, models: [], answeredBy: null, checkedAt: new Date().toISOString() };
  }

  const probes: ModelProbe[] = [];

  for (const { id, model } of getModelChain()) {
    const startedAt = Date.now();
    try {
      await generateText({
        model,
        prompt: "Reply with the single word: ok",
        temperature: 0,
        maxOutputTokens: 16,
      });
      probes.push({ id, ok: true, latencyMs: Date.now() - startedAt });
      break;
    } catch (error) {
      probes.push({
        id,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  const answered = probes.find((probe) => probe.ok);
  return {
    status: answered ? "ok" : "unavailable",
    config,
    models: probes,
    answeredBy: answered?.id ?? null,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Proves the local runtime wiring end to end: env -> AI SDK -> Gemini.
 * Deliberately reports only model IDs, latency and error class -- never the
 * key, the prompt, or a raw provider stack.
 */
export async function GET(request: Request) {
  const cached = healthCache.get(HEALTH_CACHE_KEY);
  if (cached) {
    return Response.json(cached, { status: cached.status === "ok" ? 200 : 503 });
  }

  try {
    const env = getServerEnv();
    const limited = enforceRateLimit(request, env);
    if (limited) return limited;
  } catch {
    // No env configured yet -- probeModels() below reports "misconfigured"
    // in the normal response shape rather than a differently-shaped 429.
  }

  const body = await probeModels();
  if (body.status !== "misconfigured") healthCache.set(HEALTH_CACHE_KEY, body);

  return Response.json(body, { status: body.status === "ok" ? 200 : 503 });
}
