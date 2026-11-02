import "server-only";
import { z } from "zod";
import { parseHolidays, type BusinessCalendar } from "@/domain/sla";

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  DEMO_AUTH_ENABLED: booleanFlag,
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("anthropic/claude-haiku-5-5"),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(200).max(8000).default(1200),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),
  /**
   * Test-only scripted model. Refused on Vercel so a deployment can never answer
   * employees with canned text.
   */
  NEXO_SCRIPTED_MODEL: booleanFlag,
  BUSINESS_TIMEZONE: z.string().default("America/Sao_Paulo"),
  BUSINESS_DAY_START: z.coerce.number().int().min(0).max(23).default(8),
  BUSINESS_DAY_END: z.coerce.number().int().min(1).max(24).default(18),
  BUSINESS_HOLIDAYS: z.string().optional(),
  AGENT_SESSION_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(500).default(30),
  RATE_LIMIT_TURNS_PER_MINUTE: z.coerce.number().int().min(1).default(8),
  RATE_LIMIT_TURNS_PER_DAY: z.coerce.number().int().min(1).default(150),
  RATE_LIMIT_LOGINS_PER_10MIN: z.coerce.number().int().min(1).default(20),
  LLM_GLOBAL_DAILY_TURNS: z.coerce.number().int().min(1).default(1500),
  TICKET_FAULT_RATE: z.coerce.number().min(0).max(1).default(0),
  VERCEL: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

type AppConfig = z.infer<typeof schema> & { calendar: BusinessCalendar };

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuração inválida: ${fields}`);
  }
  const env = parsed.data;
  if (env.BUSINESS_DAY_END <= env.BUSINESS_DAY_START) {
    throw new Error(
      "Configuração inválida: BUSINESS_DAY_END deve ser maior que BUSINESS_DAY_START",
    );
  }
  if (env.NEXO_SCRIPTED_MODEL && env.VERCEL) {
    throw new Error("NEXO_SCRIPTED_MODEL só pode ser usado em testes locais ou de CI");
  }
  if (env.TICKET_FAULT_RATE > 0 && env.VERCEL) {
    throw new Error("TICKET_FAULT_RATE só pode ser usado fora da Vercel");
  }
  cached = {
    ...env,
    calendar: {
      timeZone: env.BUSINESS_TIMEZONE,
      dayStartHour: env.BUSINESS_DAY_START,
      dayEndHour: env.BUSINESS_DAY_END,
      workdays: [1, 2, 3, 4, 5],
      holidays: parseHolidays(env.BUSINESS_HOLIDAYS),
    },
  };
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
