"use client"

import { useEffect, useRef } from "react"

interface VideoPanelProps {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  onEnd: () => void
}

export default function VideoPanel({
  localStream,
  remoteStream,
  onEnd,
}: VideoPanelProps) {
  const localRef = useRef<HTMLVideoElement>(null)
  const remoteRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  return (
    <section
      className="min-h-0 shrink-0 border-b border-border"
      aria-labelledby="video-heading"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-2">
        <h3 id="video-heading" className="text-sm font-medium leading-snug">
          Video call
        </h3>
        <button
          onClick={onEnd}
          className="
            inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
            px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
            duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
            bg-surface-muted text-foreground
          "
        >
          End video
        </button>
      </header>
      <div
        className="
          relative aspect-[16/10] max-h-[25dvh] w-full overflow-hidden bg-background
          [@media(max-height:600px)]:max-h-[15dvh] [@media(max-height:450px)]:max-h-[10dvh]
        "
      >
        <video
          ref={remoteRef}
          aria-label="Stranger's video"
          autoPlay
          playsInline
          className="block size-full object-contain"
        />
        {!remoteStream && (
          <p
            role="status"
            className="text-sm font-medium leading-snug absolute inset-0 grid place-items-center p-4 text-center text-muted"
          >
            Waiting for stranger&rsquo;s video…
          </p>
        )}
        <figure
          className="
            absolute right-3 bottom-3 w-[min(25%,96px)] overflow-hidden rounded-control bg-surface
            [@media(max-height:450px)]:right-2 [@media(max-height:450px)]:bottom-1
            [@media(max-height:450px)]:w-10
          "
        >
          <video
            ref={localRef}
            aria-label="Your video preview"
            autoPlay
            playsInline
            muted
            className="block aspect-[4/3] w-full object-cover"
          />
          <figcaption className="px-2 py-0.5 text-xs font-medium [@media(max-height:450px)]:hidden">
            You
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
