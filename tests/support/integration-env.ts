// Integration tests run against a dedicated database, never the dev one.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.DATABASE_URL_TEST ?? "postgresql:///nexo_assist_test?host=/var/run/postgresql",
  DEMO_AUTH_ENABLED: "true",
  NEXO_SCRIPTED_MODEL: "true",
  BUSINESS_TIMEZONE: "America/Sao_Paulo",
  AGENT_SESSION_MESSAGE_LIMIT: "30",
  RATE_LIMIT_TURNS_PER_MINUTE: "1000",
  RATE_LIMIT_TURNS_PER_DAY: "10000",
  LLM_GLOBAL_DAILY_TURNS: "100000",
  TICKET_FAULT_RATE: "0",
});
