import { readFileSync } from "node:fs";

// The eval needs the real provider key; read it from .env.local without
// exposing it anywhere else (the integration env deliberately has no key).
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^(ANTHROPIC_API_KEY|LLM_MODEL)=(.+)$/.exec(line.trim());
    if (match?.[1] && match[2] && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env.local: rely on the environment.
}
