"use client"

import { useEffect, useRef, useState } from "react"

export interface ChatMessage {
  id: number
  mine: boolean
  text: string
}

interface ChatPanelProps {
  messages: ChatMessage[]
  connected: boolean
  videoBusy: boolean
  onSend: (text: string) => void
  onStartVideo: () => void
  onEnd: () => void
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    endRef.current?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "end",
    })
  }, [messages])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !connected) return
    onSend(text)
    setDraft("")
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-labelledby="chat-heading"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4 [@media(max-height:450px)]:py-2">
        <div>
          <h2
            id="chat-heading"
            className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-2xl leading-tight"
          >
            Stranger
          </h2>
          <p
            role="status"
            className="text-sm font-medium leading-snug mt-1 text-muted"
          >
            {connected ? "Connected" : "Connecting…"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="
              inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
              px-3 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
              duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
              bg-surface-muted text-foreground
            "
          >
            Video
          </button>
          <button
            onClick={onEnd}
            title="End conversation"
            className="
              inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
              px-3 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
              duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
              bg-danger text-danger-foreground
            "
          >
            End
          </button>
        </div>
      </header>

      <div
        role="log"
        aria-label="Conversation messages"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [@media(max-height:450px)]:py-2"
      >
        {messages.length === 0 && (
          <p className="text-sm font-medium leading-snug my-6 text-center text-muted">
            {connected
              ? "Start with a hello. Messages travel directly between you and your peer."
              : "Establishing your connection. Chat will be ready when you're connected."}
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className="group/message my-3 flex data-[mine=true]:justify-end"
            data-mine={message.mine}
          >
            <span className="sr-only">
              {message.mine ? "You" : "Stranger"}:{" "}
            </span>
            <p
              className="
                max-w-[85%] rounded-control bg-surface-muted px-3.5 py-2.5 text-base leading-normal
                whitespace-pre-wrap wrap-anywhere group-data-[mine=true]/message:bg-primary
                group-data-[mine=true]/message:text-primary-foreground
              "
            >
              {message.text}
            </p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className="flex shrink-0 gap-2 border-t border-border p-4 [@media(max-height:450px)]:py-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message"
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="min-h-11 min-w-0 flex-1 rounded-control bg-surface-muted px-3 py-2.5 text-base placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="
            inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
            px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
            duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
            bg-primary text-primary-foreground shadow-[0_4px_12px_var(--shadow-warm)]
            enabled:hover:bg-primary-hover enabled:hover:shadow-[0_5px_16px_var(--shadow-warm)]
          "
        >
          Send
        </button>
      </form>
    </section>
  )
}
