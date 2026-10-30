"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LogOut, MessageCircle } from "lucide-react";
import { Dialog as RadixDialog, DropdownMenu } from "radix-ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ConversationDetailDTO, QueueResponseDTO, TicketListItemDTO } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { LogoSymbol } from "@/components/brand/logo";
import { useLogout } from "@/components/layout/employee-shell";
import { Avatar } from "@/components/ui/avatar";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ConversationPanel } from "./conversation-panel";
import { QueuePanel, type QueueFilter } from "./queue-panel";
import { TicketsPanel } from "./tickets-panel";
import { useFeed } from "./use-feed";

const DOCK_KEY = "nexo-console-tickets-panel";
const DOCK_EVENT = "nexo:tickets-panel";

// Last choice in this page, so hiding works even where storage is blocked.
let dockChoice: boolean | null = null;

function readDock(): boolean {
  if (dockChoice !== null) return dockChoice;
  try {
    return window.localStorage.getItem(DOCK_KEY) !== "hidden";
  } catch {
    return true; // Storage blocked: the panel stays docked.
  }
}

function writeDock(docked: boolean): void {
  dockChoice = docked;
  try {
    window.localStorage.setItem(DOCK_KEY, docked ? "docked" : "hidden");
  } catch {
    // Not remembered; the event below still applies it to this page.
  }
  window.dispatchEvent(new Event(DOCK_EVENT));
}

function subscribeDock(onChange: () => void): () => void {
  window.addEventListener(DOCK_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DOCK_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

type Analyst = { id: string; name: string; supportLevel: string | null };

export function ConsoleApp(props: { analyst: Analyst; timeZone: string }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2000 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Console {...props} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function Console({ analyst, timeZone }: { analyst: Analyst; timeZone: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { logout } = useLogout();
  const selectedId = params.get("c");
  const [filter, setFilter] = useState<QueueFilter>("for_you");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  // Wide screens dock the tickets panel; the analyst may hide it for more chat
  // width. A per-browser convenience kept in local storage (never authoritative).
  const docked = useSyncExternalStore(subscribeDock, readDock, () => true);
  const dock = (value: boolean) => writeDock(value);
  const showTickets = () => {
    if (window.matchMedia("(min-width: 1536px)").matches) dock(true);
    else setTicketsOpen(true);
  };

  const queue = useQuery({
    queryKey: ["queue", filter, debouncedQuery],
    queryFn: () =>
      api<QueueResponseDTO>(
        `/api/conversations?filter=${filter}&q=${encodeURIComponent(debouncedQuery)}`,
      ),
    refetchInterval: 5000,
  });

  const detail = useQuery({
    queryKey: ["conversation", selectedId],
    queryFn: () => api<ConversationDetailDTO>(`/api/conversations/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: 5000,
  });

  const employeeId = detail.data?.conversation.employee.id;
  const tickets = useQuery({
    queryKey: ["tickets", employeeId],
    queryFn: () => api<{ items: TicketListItemDTO[] }>(`/api/tickets?employeeId=${employeeId}`),
    enabled: !!employeeId,
    refetchInterval: 15000,
  });

  const presence = useQuery({
    queryKey: ["presence"],
    queryFn: () => api<{ available: boolean; online: number }>("/api/analysts/presence"),
  });
  const setAvailability = useMutation({
    mutationFn: (available?: boolean) =>
      api<{ available: boolean }>("/api/analysts/presence", {
        method: "PUT",
        json: available === undefined ? {} : { available },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["presence"] }),
    onError: (error) => toast("error", errorMessage(error)),
  });
  // Heartbeat while the console is open: drives "analistas online agora".
  const heartbeat = setAvailability.mutate;
  useEffect(() => {
    heartbeat(undefined);
    const timer = setInterval(() => heartbeat(undefined), 60_000);
    return () => clearInterval(timer);
  }, [heartbeat]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("c", id);
    else next.delete("c");
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ""}`, { scroll: false });
  };

  const refreshAll = (action?: "claim" | "return" | "close") => {
    if (action === "claim") setFilter("mine");
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
    void queryClient.invalidateQueries({ queryKey: ["conversation", selectedId] });
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
  };

  const attention = queue.data?.attention ?? 0;
  // The count also lives in the tab title, so it is seen from another tab.
  useEffect(() => {
    const base = "Console do analista · Nexo Assist";
    document.title = attention > 0 ? `(${attention}) ${base}` : base;
    // Re-applied on navigation too: selecting a conversation changes the URL.
  }, [attention, selectedId]);
  const available = presence.data?.available ?? true;

  return (
    <div className="bg-desk flex h-dvh overflow-hidden">
      <nav
        aria-label="Console"
        className="border-rule bg-paper hidden w-[72px] shrink-0 flex-col items-center border-r py-5 md:flex"
      >
        <LogoSymbol className="size-9" />
        <button
          type="button"
          onClick={() => setFilter("for_you")}
          aria-label={`Conversas que precisam de você: ${attention}`}
          className="bg-paper relative mt-8 flex size-12 items-center justify-center rounded-xl shadow-[0_2px_8px_rgba(27,36,49,0.1)]"
        >
          <MessageCircle className="size-6" aria-hidden="true" />
          {attention > 0 ? (
            <span
              key={attention}
              className="bg-cta animate-pop ring-paper absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white tabular-nums ring-2"
            >
              {attention > 99 ? "99+" : attention}
            </span>
          ) : null}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger aria-label="Menu do analista" className="mt-auto rounded-full">
            <Avatar name={analyst.name} online={available} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="right"
              align="end"
              sideOffset={8}
              className="border-rule bg-paper animate-rise z-50 min-w-[220px] rounded-lg border p-1 shadow-lg"
            >
              <div className="px-2.5 py-2">
                <p className="text-[14px] font-medium">{analyst.name}</p>
                <p className="text-ink-3 text-[13px]">{analyst.supportLevel ?? "Service desk"}</p>
              </div>
              <DropdownMenu.Separator className="bg-rule my-1 h-px" />
              <DropdownMenu.Item
                onSelect={() => setAvailability.mutate(!available)}
                className="data-[highlighted]:bg-desk flex h-9 cursor-pointer items-center rounded-md px-2.5 text-[14px] outline-none"
              >
                {available ? "Ficar ausente" : "Ficar disponível"}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={logout}
                className="data-[highlighted]:bg-desk flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[14px] outline-none"
              >
                <LogOut className="size-4" aria-hidden="true" /> Sair
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>

      <div
        className={cn(
          "border-rule w-full shrink-0 border-r xl:block xl:w-[420px]",
          selectedId ? "hidden" : "block",
        )}
      >
        <QueuePanel
          data={queue.data}
          loading={queue.isLoading}
          error={queue.error ? errorMessage(queue.error) : null}
          onRetry={() => void queue.refetch()}
          filter={filter}
          onFilter={setFilter}
          query={query}
          onQuery={setQuery}
          selectedId={selectedId}
          onSelect={select}
          analystId={analyst.id}
          timeZone={timeZone}
          available={available}
          onToggleAvailable={() => setAvailability.mutate(!available)}
        />
      </div>

      <main className={cn("min-w-0 flex-1", selectedId ? "block" : "hidden xl:block")}>
        {selectedId ? (
          <SelectedConversation
            key={selectedId}
            conversationId={selectedId}
            detail={detail.data}
            analystId={analyst.id}
            timeZone={timeZone}
            onChanged={refreshAll}
            onBack={() => select(null)}
            onShowTickets={showTickets}
            ticketsDocked={docked}
          />
        ) : (
          <div className="bg-chat text-ink-3 flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <MessageCircle className="size-8" aria-hidden="true" />
            <p className="text-[15px]">
              Selecione uma conversa para ver o histórico e os chamados do funcionário.
            </p>
          </div>
        )}
      </main>

      {selectedId && detail.data ? (
        <>
          <div
            className={cn(
              "border-rule hidden w-[400px] shrink-0 border-l",
              docked && "animate-slide-in 2xl:block",
            )}
          >
            <TicketsPanel
              employeeName={detail.data.conversation.employee.name}
              tickets={tickets.data?.items}
              loading={tickets.isLoading}
              detail={detail.data}
              timeZone={timeZone}
              onClose={() => dock(false)}
              onTicketUpdated={refreshAll}
            />
          </div>
          {/* Narrow screens: the same panel as a drawer, with focus trap, Esc and focus return. */}
          <RadixDialog.Root open={ticketsOpen} onOpenChange={setTicketsOpen}>
            <RadixDialog.Portal>
              <RadixDialog.Overlay className="bg-navy/40 animate-fade fixed inset-0 z-40 2xl:hidden" />
              <RadixDialog.Content
                aria-describedby={undefined}
                className="animate-slide-in fixed top-0 right-0 z-50 h-dvh w-full max-w-[420px] shadow-xl focus:outline-none 2xl:hidden"
              >
                <RadixDialog.Title className="sr-only">
                  Chamados de {detail.data.conversation.employee.name}
                </RadixDialog.Title>
                <TicketsPanel
                  employeeName={detail.data.conversation.employee.name}
                  tickets={tickets.data?.items}
                  loading={tickets.isLoading}
                  detail={detail.data}
                  timeZone={timeZone}
                  onClose={() => setTicketsOpen(false)}
                  onTicketUpdated={refreshAll}
                />
              </RadixDialog.Content>
            </RadixDialog.Portal>
          </RadixDialog.Root>
        </>
      ) : null}
    </div>
  );
}

function SelectedConversation({
  conversationId,
  ...rest
}: { conversationId: string } & Omit<Parameters<typeof ConversationPanel>[0], "feed">) {
  const queryClient = useQueryClient();
  const feed = useFeed(conversationId);
  const lastSeq = feed.messages[feed.messages.length - 1]?.seq;
  // Opening (and following) a conversation marks it as read for the queue counters.
  useEffect(() => {
    if (lastSeq === undefined) return;
    void api(`/api/conversations/${conversationId}/read`, { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["queue"] }))
      .catch(() => undefined);
  }, [conversationId, lastSeq, queryClient]);
  return <ConversationPanel feed={feed} {...rest} />;
}
