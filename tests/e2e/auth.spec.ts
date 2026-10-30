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
  await expect(page.getByText("Computador")).toHaveCount(0);
  await expect(page.getByText("Área", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Redefinir senha" }).click();
  // The reset happens in the corporate portal; this app sends no e-mail itself.
  await expect(page.getByRole("dialog")).toContainText("Portal do Colaborador");
  await expect(page.getByRole("dialog")).toContainText("carla.mendes@nexo.com.br");
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

test("pages ship a nonce CSP and run without policy violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  const response = await page.goto("/entrar");
  expect(response?.headers()["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  await login(page, "ana.souza@nexo.com.br");
  await expect(page.getByPlaceholder(/Escreva para/)).toBeEditable();
  await page.goto("/perfil");
  await expect(page.getByText("Ana Souza").first()).toBeVisible();
  await page.goto("/privacidade");
  await expect(page.getByRole("heading", { name: "Privacidade e uso de dados" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("signing in again revokes the session the browser held before", async ({ page, baseURL }) => {
  await login(page, "ana.souza@nexo.com.br");
  const first = (await page.context().cookies()).find((cookie) => cookie.name === "nexo_session");
  if (!first) throw new Error("no session cookie");
  // /entrar redirects a signed-in user, so sign in again through the API.
  const relogin = await page.request.post("/api/auth/login", {
    headers: { origin: baseURL ?? "" },
    data: { email: "carla.mendes@nexo.com.br", password: "x" },
  });
  expect(relogin.ok()).toBe(true);
  await page.context().clearCookies();
  await page.context().addCookies([first]);
  await page.goto("/atendimento");
  await expect(page).toHaveURL(/\/entrar/);
});
