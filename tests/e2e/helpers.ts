import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password = "senha-de-teste"): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail corporativo").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
}

export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByPlaceholder(/Escreva para/);
  await box.fill(text);
  await box.press("Enter");
}
