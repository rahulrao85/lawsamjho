import { generateText } from "ai";
import { describeServerEnv } from "@/lib/env";
import { getModelChain } from "@/lib/llm/gemini";

export const dynamic = "force-dynamic";

type ModelProbe = {
  id: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

/**
 * Proves the local runtime wiring end to end: env -> AI SDK -> Gemini.
 * Deliberately reports only model IDs, latency and error class -- never the
 * key, the prompt, or a raw provider stack.
 */
export async function GET() {
  const config = describeServerEnv();

  if (!config.ok) {
    return Response.json(
      { status: "misconfigured", config, models: [] },
      { status: 503 },
    );
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
  return Response.json(
    {
      status: answered ? "ok" : "unavailable",
      config,
      models: probes,
      answeredBy: answered?.id ?? null,
      checkedAt: new Date().toISOString(),
    },
    { status: answered ? 200 : 503 },
  );
}
