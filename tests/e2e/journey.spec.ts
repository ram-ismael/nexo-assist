import { expect, test, type Page } from "@playwright/test";
import { login, send } from "./helpers";

async function snap(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}

test("status inquiry, overdue ticket, transfer, human takeover and return", async ({ browser }) => {
  const employee = await (await browser.newContext()).newPage();
  await login(employee, "ana.souza@nexo.com.br");

  await send(employee, "Qual o status do meu chamado?");
  await expect(employee.getByText("consultou seus chamados").first()).toBeVisible();
  await expect(employee.getByText("Sobre qual deles quer saber?")).toBeVisible();
  await employee.getByRole("radio").first().waitFor();
  await employee.getByText("Notebook lento após atualização do Windows").click();
  await expect(employee.getByText("calculou o prazo")).toBeVisible();
  await expect(employee.getByText("prazo vencido")).toBeVisible();
  await snap(employee, "t3-consulta");

  await employee.getByRole("button", { name: "Por quê?" }).last().click();
  await expect(employee.getByText("O que entendeu")).toBeVisible();
  await expect(employee.getByText("Ações executadas")).toBeVisible();

  await employee.getByRole("button", { name: "Falar com um analista" }).click();
  await expect(employee.getByText(/Transferida para Suporte N2/)).toBeVisible();
  await expect(
    employee.getByRole("status").filter({ hasText: "Aguardando atendente" }),
  ).toBeVisible();

  const analyst = await (
    await browser.newContext({ viewport: { width: 1600, height: 900 } })
  ).newPage();
  await login(analyst, "rafael.lima@nexo.com.br");
  await analyst.getByRole("button", { name: /Ana Souza/ }).click();
  await expect(analyst.getByText("Ana espera um atendente")).toBeVisible();
  await expect(analyst.getByText("Motivo:")).toBeVisible();
  await snap(analyst, "t4-conversa-transferida");

  await analyst.getByRole("button", { name: "Assumir atendimento" }).click();
  await expect(analyst.getByRole("button", { name: "Encerrar atendimento" })).toBeVisible();
  const reply = analyst.getByPlaceholder(/Responder para Ana/);
  await reply.fill("Oi, Ana! Aqui é o Rafael. Vou verificar o driver de vídeo remotamente.");
  await reply.press("Enter");
  await expect(analyst.getByRole("log").getByText("Vou verificar o driver de vídeo")).toBeVisible();
  await snap(analyst, "t5-analista-atendendo");

  await expect(employee.getByRole("log").getByText("Vou verificar o driver de vídeo")).toBeVisible({
    timeout: 15_000,
  });
  await send(employee, "Posso sim, está ligado.");
  await expect(analyst.getByRole("log").getByText("Posso sim, está ligado.")).toBeVisible({
    timeout: 15_000,
  });

  await analyst.getByRole("button", { name: "Devolver ao agent" }).first().click();
  await expect(analyst.getByText("O Nexo Assist está atendendo")).toBeVisible();
  await expect(employee.getByText("Assistente online")).toBeVisible({ timeout: 15_000 });
});

test("opens a ticket only after the employee confirms the draft", async ({ page }) => {
  await login(page, "bruno.tavares@nexo.com.br");
  await send(page, "Meu notebook não conecta na VPN desde ontem. Aparece o erro 809.");
  await expect(page.getByText("buscou na central de ajuda")).toBeVisible();
  await expect(page.getByText("Quem está sendo afetado?")).toBeVisible();
  await page.getByRole("button", { name: "Só eu" }).click();
  await expect(page.getByText("Aguardando confirmação")).toBeVisible();
  await expect(page.getByText("Rascunho D-")).toBeVisible();
  await snap(page, "t2-rascunho");

  const before = await page.request.get("/api/tickets");
  const countBefore = ((await before.json()) as { items: unknown[] }).items.length;
  await page.getByRole("button", { name: /^Confirmar/ }).click();
  await expect(page.getByText(/Pronto: abri o chamado INC-\d+/)).toBeVisible();
  const after = await page.request.get("/api/tickets");
  expect(((await after.json()) as { items: unknown[] }).items.length).toBe(countBefore + 1);
  await expect(page.getByRole("button", { name: /^Confirmar/ })).toHaveCount(0);
});
