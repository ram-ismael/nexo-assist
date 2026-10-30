import type { Metadata } from "next";
import { ChatView } from "@/components/chat/chat-view";
import { config } from "@/lib/config";
import type { MessagePageDTO } from "@/lib/api-types";
import { requirePageUser } from "@/server/auth/current-user";
import { db } from "@/server/db/client";
import { findLiveConversation, pageMessages } from "@/server/conversations/repository";
import { serializeConversation, serializeMessages } from "@/server/conversations/serialize";
import { recoverAbandonedTurns } from "@/server/conversations/use-cases";

export const metadata: Metadata = { title: "Atendimento" };

export default async function AttendancePage() {
  const user = await requirePageUser("employee");
  const env = config();
  let conversation = await findLiveConversation(db(), user.id);
  if (conversation && (await recoverAbandonedTurns(conversation.id))) {
    conversation = await findLiveConversation(db(), user.id);
  }
  let initial: MessagePageDTO | null = null;
  if (conversation) {
    const page = await pageMessages(db(), conversation.id, { limit: 30 });
    initial = {
      conversation: await serializeConversation(
        db(),
        conversation,
        env.AGENT_SESSION_MESSAGE_LIMIT,
      ),
      messages: await serializeMessages(db(), page.messages),
      hasMoreBefore: page.hasMoreBefore,
    };
  }
  return (
    <ChatView
      initial={initial}
      timeZone={env.calendar.timeZone}
      userId={user.id}
      llmAvailable={env.NEXO_SCRIPTED_MODEL || !!env.ANTHROPIC_API_KEY}
    />
  );
}
