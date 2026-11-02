"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const MAX_LENGTH = 2000;

function readDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): drafts simply are not kept.
  }
}

/**
 * The one message field of the app, identical for the employee and the analyst.
 * Enter sends, Shift+Enter breaks the line. The unsent text survives refresh
 * (local draft, never authoritative) and failed sends.
 */
export function Composer({
  draftKey,
  placeholder,
  disabled,
  busy,
  onSend,
  maxLength = MAX_LENGTH,
  typing,
  autoFocus,
}: {
  draftKey: string;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => Promise<boolean>;
  maxLength?: number;
  /** "Está escrevendo…" signal for the other person, when one is listening. */
  typing?: { onTextChange: (text: string) => void; onBlur: () => void; onSent: () => void };
  /** Ready to type as soon as it appears (e.g. right after assuming a conversation). */
  autoFocus?: boolean;
}) {
  // The draft lives only in this browser; the server render always starts empty.
  const [value, setValue] = useState(() =>
    typeof window === "undefined" ? "" : readDraft(draftKey),
  );
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [value]);

  const update = (next: string) => {
    setValue(next);
    writeDraft(draftKey, next);
  };

  const submit = async () => {
    const text = value.trim();
    if (!text || disabled || busy || text.length > maxLength) return;
    update("");
    const accepted = await onSend(text);
    // The stored message clears the typing signal on the server.
    if (accepted) typing?.onSent();
    else update(text);
    textarea.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const tooLong = value.length > maxLength;
  return (
    <div>
      <div
        className={cn(
          "bg-paper focus-within:border-primary focus-within:ring-primary/15 flex items-end gap-2 rounded-xl border p-2 transition-colors focus-within:ring-2",
          tooLong ? "border-danger" : "border-rule",
          disabled && "opacity-70",
        )}
      >
        <label htmlFor={`composer-${draftKey}`} className="sr-only">
          {placeholder}
        </label>
        <textarea
          id={`composer-${draftKey}`}
          ref={textarea}
          rows={1}
          autoFocus={autoFocus}
          suppressHydrationWarning
          value={value}
          disabled={disabled}
          onChange={(event) => {
            update(event.target.value);
            typing?.onTextChange(event.target.value);
          }}
          onBlur={typing?.onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="text-ink placeholder:text-ink-3 max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-6 outline-none disabled:cursor-not-allowed sm:text-[16px]"
        />
        <Button
          onClick={submit}
          disabled={disabled || !value.trim() || tooLong}
          loading={busy}
          className="h-10 px-4"
        >
          {!busy ? <ArrowUp className="size-4" aria-hidden="true" /> : null}
          Enviar
        </Button>
      </div>
      {tooLong ? (
        <p className="text-danger-text mt-1 text-[13px]">
          Mensagem longa demais ({value.length}/{maxLength} caracteres).
        </p>
      ) : null}
    </div>
  );
}
