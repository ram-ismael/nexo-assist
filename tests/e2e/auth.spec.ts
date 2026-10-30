import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("validates the form and rejects unknown e-mails", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Informe um e-mail corporativo válido.")).toBeVisible();
  await page.getByLabel("E-mail corporativo").fill("intruso@nexo.com.br");
  await page.getByLabel("Senha", { exact: true }).fill("x");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail não encontrado")).toBeVisible();
});

test("employee session survives refresh and logout invalidates it", async ({ page }) => {
  await login(page, "ana.souza@nexo.com.br");
  await expect(page).toHaveURL(/\/atendimento/);
  await page.reload();
  await expect(page.getByText("Ana Souza").first()).toBeVisible();
  await page.goto("/console");
  await expect(page).toHaveURL(/\/atendimento/);
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.goto("/atendimento");
  await expect(page).toHaveURL(/\/entrar/);
});

test("analysts land on the console", async ({ page }) => {
  await login(page, "rafael.lima@nexo.com.br");
  await expect(page).toHaveURL(/\/console/);
  await expect(page.getByRole("heading", { name: "Conversas" })).toBeVisible();
});

test("profile shows the signed-in identity and honest credential info", async ({ page }) => {
  await login(page, "carla.mendes@nexo.com.br");
  await page.getByRole("link", { name: "Meu perfil" }).click();
  await expect(page.getByText("carla.mendes@nexo.com.br").first()).toBeVisible();
  await expect(page.getByText("Ana Souza")).toHaveCount(0);
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  await expect(page.getByRole("dialog")).toContainText("nenhum e-mail será enviado");
});

test("employees cannot read other employees' tickets through the API", async ({ page }) => {
  await login(page, "carla.mendes@nexo.com.br");
  const response = await page.request.get("/api/tickets/INC-20311");
  expect(response.status()).toBe(404);
  const own = await page.request.get("/api/tickets/REQ-10451");
  expect(own.status()).toBe(200);
});

test("mutations from another origin are rejected", async ({ page }) => {
  await login(page, "ana.souza@nexo.com.br");
  const response = await page.request.post("/api/conversations", {
    headers: { origin: "https://evil.example" },
  });
  expect(response.status()).toBe(403);
});
