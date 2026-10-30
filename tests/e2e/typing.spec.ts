import { expect, test } from "@playwright/test";
import { login, send } from "./helpers";

test("streams the answer in place and shows real typing between employee and analyst", async ({
  browser,
}) => {
  const employee = await (await browser.newContext()).newPage();
  await login(employee, "fabio.nunes@nexo.com.br");

  // The agent's answer is written into one live bubble that becomes the message.
  await send(employee, "Qual o status do meu chamado?");
  await expect(employee.getByText("consultou seus chamados").first()).toBeVisible();
  await expect(employee.locator(".animate-caret")).toHaveCount(0);
  await expect(employee.getByRole("button", { name: "Por quê?" })).toHaveCount(1);

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
});
