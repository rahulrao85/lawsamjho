import { z } from "zod";

/**
 * Server-only environment configuration.
 *
 * Parsed lazily and memoised so that importing this module never throws at
 * build time -- a missing key must surface as a clear runtime error on the
 * request that needs it, not as an opaque `next build` failure.
 *
 * Model IDs are pinned rather than aliased (`gemini-flash-latest` would drift
 * under us mid-event). `gemini-2.5-flash` was the original default but returns
 * 404 "no longer available to new users" on the project's actual key -- Google
 * points new accounts at the gemini-3.x line instead. Re-verify directly against
 * generativelanguage.googleapis.com before trusting any model ID here again;
 * availability is clearly per-key/per-account, not a fixed list.
 *
 * Primary/fallback both confirmed working (HTTP 200) against the project key
 * on 16-Sep-2026: gemini-3.6-flash, gemini-3.5-flash, gemini-3.1-flash-lite.
 */
const serverEnvSchema = z.object({
  GEMINI_API_KEY: z
    .string()
    .min(1, "GEMINI_API_KEY is required -- see .env.example"),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.6-flash"),
  GEMINI_FALLBACK_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2_000_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid server configuration: ${issues.join("; ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

let cached: ServerEnv | undefined;

/**
 * Throws `ConfigError` when the environment is incomplete. Callers that render
 * to a user (e.g. the health endpoint) should catch it and surface a readable
 * message rather than leaking a stack trace.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    );
  }

  cached = parsed.data;
  return cached;
}

/** Non-throwing variant for status/health reporting. */
export function describeServerEnv(): {
  ok: boolean;
  issues: string[];
  model?: string;
  fallbackModel?: string;
} {
  try {
    const env = getServerEnv();
    return {
      ok: true,
      issues: [],
      model: env.GEMINI_MODEL,
      fallbackModel: env.GEMINI_FALLBACK_MODEL,
    };
  } catch (error) {
    if (error instanceof ConfigError) {
      return { ok: false, issues: error.issues };
    }
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "unknown error"],
    };
  }
}

/** Test seam -- resets the memoised value so tests stay isolated. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
