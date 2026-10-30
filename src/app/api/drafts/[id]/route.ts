import { z } from "zod";
import { config } from "@/lib/config";
import { AFFECTED_SCOPES, TICKET_CATEGORIES, TICKET_TYPES } from "@/domain/tickets";
import { db } from "@/server/db/client";
import { json, readJson, route } from "@/server/http";
import { loadDrafts } from "@/server/conversations/repository";
import { draftToDTO } from "@/server/conversations/serialize";
import { editDraft, findDraftForEmployee } from "@/server/tickets/drafts";

const schema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(5).max(120).optional(),
  description: z.string().trim().min(10).max(2000).optional(),
  note: z.string().trim().min(3).max(2000).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  scope: z.enum(AFFECTED_SCOPES).optional(),
});

/** Employee edits a pending draft; priority is recalculated, never typed in. */
export const PATCH = route<"employee", { id: string }>(
  "employee",
  async ({ req, user, params }) => {
    const body = await readJson(req, schema);
    const updated = await db().transaction(async (tx) => {
      const draft = await findDraftForEmployee(tx, user.id, params.id, { lock: true });
      return editDraft(tx, config().calendar, draft, body);
    });
    const full = (await loadDrafts(db(), [updated.id])).get(updated.id);
    return json({ draft: full ? draftToDTO(full) : null });
  },
);
