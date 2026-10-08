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
    <section className="pulse-chat" aria-labelledby="chat-heading">
      <header className="pulse-chat-header">
        <div>
          <h2 id="chat-heading" className="type-card-heading">
            Stranger
          </h2>
          <p role="status" className="type-status mt-1 text-muted">
            {connected ? "Connected" : "Connecting…"}
          </p>
        </div>
        <div className="pulse-chat-actions">
          <button
            onClick={onStartVideo}
            disabled={!connected || videoBusy}
            className="pulse-button pulse-button-secondary"
          >
            Video
          </button>
          <button
            onClick={onEnd}
            title="End conversation"
            className="pulse-button pulse-button-danger"
          >
            End
          </button>
        </div>
      </header>

      <div
        role="log"
        aria-label="Conversation messages"
        className="pulse-messages"
      >
        {messages.length === 0 && (
          <p className="pulse-chat-empty type-status text-muted">
            {connected
              ? "Start with a hello. Messages travel directly between you and your peer."
              : "Establishing your connection. Chat will be ready when you're connected."}
          </p>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className="pulse-message"
            data-mine={message.mine}
          >
            <span className="sr-only">
              {message.mine ? "You" : "Stranger"}:{" "}
            </span>
            <p className="pulse-message-bubble type-chat">{message.text}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="pulse-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Message"
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="pulse-composer-input"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="pulse-button pulse-button-primary"
        >
          Send
        </button>
      </form>
    </section>
  )
}
