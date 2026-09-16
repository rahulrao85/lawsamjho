import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getServerEnv } from "@/lib/env";

/**
 * One provider, one primary model, one fallback tier.
 *
 * The IDs live in src/lib/env.ts (validated, overridable) so there is exactly
 * one source of truth -- the reasoning behind the specific defaults is
 * documented there.
 */

type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;

let provider: GoogleProvider | undefined;

function getProvider(): GoogleProvider {
  if (provider) return provider;
  provider = createGoogleGenerativeAI({ apiKey: getServerEnv().GEMINI_API_KEY });
  return provider;
}

/** Primary first, fallback second. Ordered, de-duplicated. */
export function getModelChain() {
  const env = getServerEnv();
  const ids = [env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL];
  return [...new Set(ids)].map((id) => ({ id, model: getProvider()(id) }));
}

/** Test seam -- clears the memoised provider. */
export function resetProviderCache(): void {
  provider = undefined;
}
