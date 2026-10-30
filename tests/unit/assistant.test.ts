import { describe, expect, it } from "vitest";
import { assistantStatusFrom, type RecentTurn } from "@/domain/assistant";

const ok: RecentTurn = { status: "completed", errorCode: null };
const failed = (errorCode: string): RecentTurn => ({ status: "failed", errorCode });

describe("assistantStatusFrom", () => {
  it("is unavailable without a configured provider, whatever the history", () => {
    expect(assistantStatusFrom(false, [ok, ok, ok])).toBe("unavailable");
  });

  it("is online with no recent traffic or with any success among the latest turns", () => {
    expect(assistantStatusFrom(true, [])).toBe("online");
    expect(assistantStatusFrom(true, [failed("llm_timeout"), failed("llm_error"), ok])).toBe(
      "online",
    );
  });

  it("needs three provider failures in a row to call it degraded", () => {
    expect(assistantStatusFrom(true, [failed("llm_timeout"), failed("llm_error")])).toBe("online");
    expect(
      assistantStatusFrom(true, [
        failed("llm_overloaded"),
        failed("llm_timeout"),
        failed("llm_error"),
      ]),
    ).toBe("degraded");
  });

  it("does not blame the provider for our own failures", () => {
    expect(
      assistantStatusFrom(true, [failed("abandoned"), failed("rate_limited"), failed("llm_error")]),
    ).toBe("online");
  });

  it("reports rejected credentials as unavailable", () => {
    expect(
      assistantStatusFrom(true, [failed("llm_auth"), failed("llm_auth"), failed("llm_auth")]),
    ).toBe("unavailable");
  });
});
