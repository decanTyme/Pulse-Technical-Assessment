"use client"

import { useEffect, useId, useRef } from "react"

interface ConnectionPromptProps {
  title: string
  subtitle?: string
  acceptLabel: string
  declineLabel: string
  onAccept: () => void
  onDecline: () => void
}

export default function ConnectionPrompt({
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: ConnectionPromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const subtitleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="pulse-prompt"
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        onDecline()
      }}
    >
      <h2 id={titleId} className="type-card-heading">
        {title}
      </h2>
      {subtitle && (
        <p id={subtitleId} className="type-body mt-3 text-muted">
          {subtitle}
        </p>
      )}
      <div className="pulse-prompt-actions">
        <button
          onClick={onDecline}
          className="pulse-button pulse-button-secondary"
        >
          {declineLabel}
        </button>
        <button
          onClick={onAccept}
          className="pulse-button pulse-button-primary"
        >
          {acceptLabel}
        </button>
      </div>
    </dialog>
  )
}
