"use client";

import { ArrowUp, Send } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
 * Enter sends, Shift+Enter breaks the line. The unsent text survives refresh
 * (local draft, never authoritative) and failed sends.
 */
export function Composer({
  draftKey,
  placeholder,
  disabled,
  busy,
  onSend,
  variant = "employee",
  maxLength = MAX_LENGTH,
}: {
  draftKey: string;
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend: (text: string) => Promise<boolean>;
  variant?: "employee" | "console";
  maxLength?: number;
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
    if (!accepted) update(text);
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
          variant === "console" && "bg-desk focus-within:bg-paper rounded-2xl border-transparent",
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
          suppressHydrationWarning
          value={value}
          disabled={disabled}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="text-ink placeholder:text-ink-3 max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] leading-6 outline-none disabled:cursor-not-allowed sm:text-[16px]"
        />
        {variant === "employee" ? (
          <Button
            onClick={submit}
            disabled={disabled || !value.trim() || tooLong}
            loading={busy}
            className="h-10 px-4"
          >
            {!busy ? <ArrowUp className="size-4" aria-hidden="true" /> : null}
            Enviar
          </Button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim() || tooLong || busy}
            aria-label={busy ? "Enviando mensagem" : "Enviar mensagem"}
            aria-busy={busy || undefined}
            className="bg-cta hover:bg-cta-hover flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-[background-color,transform,opacity] duration-150 active:scale-95 disabled:opacity-50"
          >
            {busy ? <Spinner className="size-5" /> : <Send className="size-5" aria-hidden="true" />}
          </button>
        )}
      </div>
      {tooLong ? (
        <p className="text-danger-text mt-1 text-[13px]">
          Mensagem longa demais ({value.length}/{maxLength} caracteres).
        </p>
      ) : null}
    </div>
  );
}
