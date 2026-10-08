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
    <section className="pulse-video-panel" aria-labelledby="video-heading">
      <header className="pulse-video-header">
        <h3 id="video-heading" className="type-status">
          Video call
        </h3>
        <button onClick={onEnd} className="pulse-button pulse-button-secondary">
          End video
        </button>
      </header>
      <div className="pulse-video-stage">
        <video
          ref={remoteRef}
          aria-label="Stranger's video"
          autoPlay
          playsInline
          className="pulse-remote-video"
        />
        {!remoteStream && (
          <p
            role="status"
            className="pulse-video-waiting type-status text-muted"
          >
            Waiting for stranger&rsquo;s video…
          </p>
        )}
        <figure className="pulse-local-preview">
          <video
            ref={localRef}
            aria-label="Your video preview"
            autoPlay
            playsInline
            muted
          />
          <figcaption>You</figcaption>
        </figure>
      </div>
    </section>
  )
}
