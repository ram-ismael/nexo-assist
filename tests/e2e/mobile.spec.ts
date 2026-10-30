import { expect, test } from "@playwright/test";
import { login, send } from "./helpers";

test("employee chat works on a phone without horizontal scroll", async ({ page }) => {
  await login(page, "elisa.prado@nexo.com.br");
  await send(page, "Qual o status do meu chamado?");
  await expect(page.getByText("consultou seus chamados").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("link", { name: "Meu perfil" })).toBeVisible();
});

test("analyst console is navigable on a phone", async ({ page }) => {
  await login(page, "marina.costa@nexo.com.br");
  await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible();
  await page.getByRole("button", { name: /Todas/ }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
