import { z } from "zod";
import { runAgentTurn, submitEmployeeMessage, type StreamEvent } from "@/server/agent/turn";
import { json, readJson, route } from "@/server/http";
import { log } from "@/server/log";

export const maxDuration = 60;

const schema = z.object({
  conversationId: z.uuid().nullable(),
  clientId: z.string().min(8).max(64),
  text: z
    .string()
    .trim()
    .min(1, "Escreva uma mensagem.")
    .max(2000, "Mensagem longa demais (máx. 2.000 caracteres)."),
  retryOfMessageId: z.uuid().optional(),
});

/**
 * Employee message endpoint. When the agent owns the conversation the response
 * is an NDJSON stream (accepted → action/text events → done|error); when a
 * person owns it, the message is stored for the analyst and returned as JSON.
 */
export const POST = route("employee", async ({ req, user, requestId }) => {
  const body = await readJson(req, schema);
  const result = await submitEmployeeMessage(user, body);
  if (result.mode !== "agent") return json(result);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client went away: keep running so the turn is still persisted.
          open = false;
        }
      };
      try {
        await runAgentTurn(user, result, emit);
      } catch (error) {
        log("error", "chat stream crashed", { requestId, error: String(error) });
        emit({
          type: "error",
          code: "internal",
          message: "Algo deu errado do nosso lado. Tente novamente.",
          retryable: true,
          notice: null,
          conversation: null,
        });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
});
