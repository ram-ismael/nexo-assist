import { expect, test } from "@playwright/test";
import { login, send } from "./helpers";

test("streams the answer in place and shows real typing between employee and analyst", async ({
  browser,
}) => {
  const employee = await (await browser.newContext()).newPage();
  await login(employee, "fabio.nunes@nexo.com.br");

  // The agent's answer is written into one live bubble that becomes the message:
  // dots while it works, then the text grows progressively, never as one block.
  // Every DOM change of the live bubble is recorded (no timer, so a slow or
  // throttled runner cannot skip the in-between states).
  await employee.evaluate(() => {
    const samples: { dots: boolean; text: number }[] = [];
    Object.assign(window, { liveSamples: samples });
    new MutationObserver(() => {
      const live = document.querySelector('[role="log"] [aria-busy="true"]');
      if (!live) return;
      samples.push({
        dots: !!live.querySelector('[aria-label*="Nexo Assist"], [aria-label*="Enviando"]'),
        text: live.querySelector("p")?.textContent?.length ?? 0,
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await send(employee, "Qual o status do meu chamado?");
  await expect(employee.getByText("consultou seus chamados").first()).toBeVisible();
  // The trail shows while the turn runs; only the stored message has "Por quê?".
  await expect(employee.getByRole("button", { name: "Por quê?" })).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(employee.locator(".animate-caret")).toHaveCount(0);
  const samples = await employee.evaluate(
    () => (window as unknown as { liveSamples: { dots: boolean; text: number }[] }).liveSamples,
  );
  expect(samples.some((sample) => sample.dots)).toBe(true);
  const partial = new Set(samples.map((sample) => sample.text).filter((length) => length > 0));
  expect(partial.size).toBeGreaterThanOrEqual(2);

  await employee.getByRole("button", { name: "Mais opções" }).click();
  await employee.getByRole("menuitem", { name: "Falar com um analista" }).click();
  await expect(employee.getByText(/Transferida para Suporte/)).toBeVisible();

  const analyst = await (
    await browser.newContext({ viewport: { width: 1600, height: 900 } })
  ).newPage();
  await login(analyst, "marina.costa@nexo.com.br");
  await analyst.getByRole("button", { name: /Fábio Nunes/ }).click();
  await analyst.getByRole("button", { name: "Assumir atendimento" }).click();
  const reply = analyst.getByPlaceholder(/Responder para Fábio/);
  await expect(reply).toBeVisible();
  // The employee sees who is serving them and that the analyst is really online.
  await expect(employee.getByRole("status", { name: "Marina Costa · Online" })).toBeVisible({
    timeout: 8_000,
  });

  // Analyst types: the employee sees it; sending ends it with the message.
  await reply.fill("Oi, Fábio! Já estou olhando");
  await expect(employee.getByRole("status", { name: "Marina está escrevendo" })).toBeVisible({
    timeout: 8_000,
  });
  await reply.press("Enter");
  await expect(employee.getByRole("log").getByText("Oi, Fábio! Já estou olhando")).toBeVisible({
    timeout: 8_000,
  });
  await expect(employee.getByRole("status", { name: "Marina está escrevendo" })).toBeHidden();

  // Employee types: the analyst sees it; clearing the text takes it away.
  const box = employee.getByPlaceholder(/Escreva para/);
  await box.fill("Obrigado, vou aguardar");
  await expect(analyst.getByRole("status", { name: "Fábio está escrevendo" })).toBeVisible({
    timeout: 8_000,
  });
  await box.fill("");
  await expect(analyst.getByRole("status", { name: "Fábio está escrevendo" })).toBeHidden({
    timeout: 8_000,
  });

  // Closing the console takes the analyst offline at once, counted from that moment.
  await analyst.close({ runBeforeUnload: true });
  await expect(
    employee.getByRole("status", { name: "Marina Costa · Offline há 1 min" }),
  ).toBeVisible({ timeout: 8_000 });
});
