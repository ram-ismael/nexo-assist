import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("long history opens at the latest messages and loads older pages on scroll", async ({
  page,
  browser,
  baseURL,
}) => {
  await login(page, "gabriela.rocha@nexo.com.br");
  // API calls from the test carry the same Origin a browser would send (CSRF check).
  const headers = { origin: new URL(page.url()).origin };
  const created = await page.request.post("/api/conversations", { headers });
  const { conversation } = (await created.json()) as { conversation: { id: string } };
  expect(
    (await page.request.post(`/api/conversations/${conversation.id}/handoff`, { headers })).ok(),
  ).toBe(true);

  // A long history written by the analyst: employee messages are capped at 30
  // per session (PRD), the analyst's are not.
  const analyst = await browser.newContext({ baseURL });
  const signIn = await analyst.request.post("/api/auth/login", {
    headers,
    data: { email: "marina.costa@nexo.com.br", password: "x" },
  });
  expect(signIn.ok()).toBe(true);
  expect(
    (await analyst.request.post(`/api/conversations/${conversation.id}/claim`, { headers })).ok(),
  ).toBe(true);
  for (let index = 1; index <= 110; index += 1) {
    const response = await analyst.request.post(`/api/conversations/${conversation.id}/reply`, {
      headers,
      data: { clientId: `history-${index}-e2e`, text: `Mensagem ${index}` },
    });
    expect(response.ok()).toBe(true);
  }
  await analyst.close();

  await page.goto("/atendimento");
  const log = page.getByRole("log", { name: "Mensagens da conversa" });
  await expect(log.getByText("Mensagem 110", { exact: true })).toBeVisible();
  await expect(log.getByText("Mensagem 1", { exact: true })).toHaveCount(0);
  const initial = await log.getByText(/^Mensagem \d+$/).count();
  expect(initial).toBeLessThanOrEqual(30);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await log.getByText("Início da conversa").count()) > 0) break;
    await log.evaluate((element) => element.scrollTo({ top: 0 }));
    await page.waitForTimeout(400);
  }
  await expect(log.getByText("Mensagem 1", { exact: true })).toBeAttached();
  const texts = await log.getByText(/^Mensagem \d+$/).allTextContents();
  expect(texts).toHaveLength(110);
  expect(new Set(texts).size).toBe(110);
});
