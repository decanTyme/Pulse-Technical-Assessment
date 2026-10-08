"use client"

import { useEffect, useId, useRef } from "react"
import { getSlideDurationMs } from "./SlidePresence"

interface ConnectionPromptProps {
  open: boolean
  title: string
  subtitle?: string
  acceptLabel: string
  declineLabel: string
  onAccept: () => void
  onDecline: () => void
}

export default function ConnectionPrompt({
  open,
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

    if (open) {
      if (!dialog.open) dialog.showModal()
      return
    }

    if (!dialog.open) return
    const timeout = window.setTimeout(
      () => dialog.close(),
      getSlideDurationMs(),
    )
    return () => window.clearTimeout(timeout)
  }, [open])

  useEffect(
    () => () => {
      if (dialogRef.current?.open) dialogRef.current.close()
    },
    [],
  )

  return (
    <dialog
      ref={dialogRef}
      aria-hidden={!open}
      inert={!open}
      data-slide-presence={open ? "enter" : "exit"}
      className="
        fixed inset-0 top-auto bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto my-0
        max-h-[calc(100dvh-3rem)] w-[min(380px,calc(100%-2rem))] overflow-y-auto rounded-panel border-0
        pointer-events-auto bg-surface p-6 text-foreground shadow-[0_8px_32px_var(--shadow-warm)] backdrop:bg-background/55
        md:top-0 md:bottom-0 md:my-auto
      "
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(event) => {
        event.preventDefault()
        if (open) onDecline()
      }}
    >
      <h2
        id={titleId}
        className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-2xl leading-tight"
      >
        {title}
      </h2>
      {subtitle && (
        <p id={subtitleId} className="mt-3 text-base leading-normal text-muted">
          {subtitle}
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onDecline}
          className="
            inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
            px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
            duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
            bg-surface-muted text-foreground flex-1
          "
        >
          {declineLabel}
        </button>
        <button
          onClick={onAccept}
          className="
            inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
            px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
            duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
            bg-primary text-primary-foreground shadow-[0_4px_12px_var(--shadow-warm)]
            enabled:hover:bg-primary-hover enabled:hover:shadow-[0_5px_16px_var(--shadow-warm)] flex-1
          "
        >
          {acceptLabel}
        </button>
      </div>
    </dialog>
  )
}
