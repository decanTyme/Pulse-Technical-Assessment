"use client"

import { useEffect, useRef, useState } from "react"
import EntryGate from "./components/EntryGate"
import ThemeSelector from "./components/ThemeSelector"
import WorldMap from "./components/WorldMap"
import ConnectionPrompt from "./components/ConnectionPrompt"
import ChatPanel, { type ChatMessage } from "./components/ChatPanel"
import VideoPanel from "./components/VideoPanel"
import { join, leave, poll, sendSignal } from "@/lib/api"
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc"
import { POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "@/lib/presence"
import {
  type MapLocation,
  type PeerDot,
  type SignalMsg,
  type SignalType,
} from "@/lib/types"

interface ConnectionAttempt {
  peerId: string
  connectionId: string
}

type Conn =
  | { kind: "idle" }
  | (ConnectionAttempt & {
      kind: "requesting" | "incoming" | "connecting" | "connected"
    })

type VideoState = "none" | "requesting" | "incoming" | "active"
type PresenceStatus = "loading" | "ready" | "degraded"

interface PendingCleanup extends ConnectionAttempt {
  peer: PeerSession | null
  operation: Promise<void>
  failed: boolean
}

export default function Home() {
  const [phase, setPhase] = useState<"gate" | "live">("gate")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [peers, setPeers] = useState<PeerDot[]>([])
  const [presenceStatus, setPresenceStatus] =
    useState<PresenceStatus>("loading")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [myLocation, setMyLocation] = useState<MapLocation | null>(null)

  const [conn, _setConn] = useState<Conn>({ kind: "idle" })
  const connRef = useRef<Conn>(conn)
  const setConn = (c: Conn) => {
    connRef.current = c
    _setConn(c)
  }

  const [video, _setVideo] = useState<VideoState>("none")
  const videoRef = useRef<VideoState>(video)
  const videoAttemptRef = useRef(0)

  const setVideo = (v: VideoState) => {
    videoAttemptRef.current++
    videoRef.current = v
    _setVideo(v)
  }

  const peerRef = useRef<PeerSession | null>(null)
  const msgId = useRef(0)
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writtenRequest = useRef<Conn | null>(null)
  const outgoingSignals = useRef<Promise<void>>(Promise.resolve())
  const pendingCleanup = useRef<PendingCleanup | null>(null)

  function isCurrentAttempt(attempt: Conn) {
    return connRef.current === attempt
  }

  function isCurrentVideoAttempt(peer: PeerSession, attempt: number) {
    return peerRef.current === peer && videoAttemptRef.current === attempt
  }

  function queueSignal(
    attempt: ConnectionAttempt,
    type: SignalType,
    payload?: string,
    shouldSend: () => boolean = () => true,
  ): Promise<void> {
    const operation = outgoingSignals.current.then(async () => {
      if (sessionId && shouldSend())
        await sendSignal(
          sessionId,
          attempt.peerId,
          type,
          attempt.connectionId,
          payload,
        )
    })

    // A rejection remains visible to its caller without blocking later cleanup.
    outgoingSignals.current = operation.catch(() => {})

    return operation
  }

  function releasePeer(
    attempt: ConnectionAttempt,
    peer: PeerSession | null = null,
  ) {
    const previous = pendingCleanup.current
    if (
      previous?.peerId === attempt.peerId &&
      previous.connectionId === attempt.connectionId &&
      !previous.failed
    ) {
      return previous.operation
    }

    const cleanup: PendingCleanup = {
      ...attempt,
      peer,
      operation: Promise.resolve(),
      failed: false,
    }
    pendingCleanup.current = cleanup
    cleanup.operation = queueSignal(attempt, "end")
      .then(() => peer?.endChat())
      .then(() => {
        if (pendingCleanup.current === cleanup) pendingCleanup.current = null
      })
      .catch((error: unknown) => {
        cleanup.failed = true
        peer?.close()
        throw error
      })
    return cleanup.operation
  }

  async function finishCleanup() {
    const cleanup = pendingCleanup.current
    if (!cleanup) return
    // A new user attempt may retry end; never automatically retry request/accept.
    if (cleanup.failed) await releasePeer(cleanup, cleanup.peer)
    else await cleanup.operation
  }

  function showNotice(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 3500)
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }])
  }

  function teardown(message?: string, closePeer = true) {
    if (requestTimer.current) {
      clearTimeout(requestTimer.current)
    }
    requestTimer.current = null
    writtenRequest.current = null

    const peer = peerRef.current
    peerRef.current = null
    peer?.stopVideo()
    if (closePeer) peer?.close()

    setLocalStream(null)
    setRemoteStream(null)
    setVideo("none")
    setMessages([])
    setConn({ kind: "idle" })
    if (message) showNotice(message)
    return peer
  }

  function startPeer(attempt: ConnectionAttempt, initiator: boolean) {
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        if (peerRef.current === ps) {
          void queueSignal(
            attempt,
            type,
            payload,
            () => peerRef.current === ps,
          ).catch(() => {
            if (peerRef.current === ps) {
              disconnect("Connection request failed. Please try again.")
            }
          })
        }
      },
      onChat: (text) => {
        if (peerRef.current === ps) addMessage(false, text)
      },
      onControl: (ctrl) => {
        if (peerRef.current === ps) handleControl(ctrl)
      },
      onRemoteStream: (stream) => {
        if (peerRef.current === ps) setRemoteStream(stream)
      },
      onConnectionState: (state) => {
        if (peerRef.current !== ps) return
        if (state === "failed") {
          disconnect("Connection failed (network).")
        } else if (state === "closed") {
          disconnect("Stranger disconnected.")
        }
      },
      onChannelOpen: () => {
        if (peerRef.current === ps) setConn({ ...attempt, kind: "connected" })
      },
    })

    peerRef.current = ps
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming")
        break
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          const attempt = videoAttemptRef.current
          ps.startVideo()
            .then((stream) => {
              if (!stream || !isCurrentVideoAttempt(ps, attempt)) return
              setLocalStream(stream)
              setVideo("active")
            })
            .catch(() => {
              if (!isCurrentVideoAttempt(ps, attempt)) return
              setVideo("none")
              ps.sendControl("video-end")
              showNotice("Camera unavailable.")
            })
        }
        break
      case "video-decline":
        if (videoRef.current === "requesting") {
          ps?.stopVideo()
          setVideo("none")
          showNotice("Video declined.")
        }
        break
      case "video-end":
        ps?.stopVideo()
        setLocalStream(null)
        setRemoteStream(null)
        setVideo("none")
        break
    }
  }

  async function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return

    const attempt: Conn = {
      kind: "requesting",
      peerId,
      connectionId: crypto.randomUUID(),
    }

    setConn(attempt)
    requestTimer.current = setTimeout(() => {
      if (isCurrentAttempt(attempt)) {
        const needsCleanup = writtenRequest.current === attempt
        teardown("No answer.")
        if (needsCleanup) {
          void releasePeer(attempt).catch(() => {
            showNotice("Couldn't finish disconnecting. Please try again.")
          })
        }
      }
    }, REQUEST_TIMEOUT_MS)

    try {
      await finishCleanup()
      await queueSignal(attempt, "request", undefined, () => {
        if (!isCurrentAttempt(attempt)) return false
        writtenRequest.current = attempt
        return true
      })
    } catch {
      if (!isCurrentAttempt(attempt)) return

      const needsCleanup = writtenRequest.current === attempt
      teardown("Connection request failed. Please try again.")

      if (needsCleanup) {
        void releasePeer(attempt).catch(() => {
          showNotice("Couldn't finish disconnecting. Please try again.")
        })
      }
    }
  }

  function cancelRequest() {
    const current = connRef.current
    const needsCleanup = writtenRequest.current === current
    teardown()
    if (current.kind === "requesting" && needsCleanup) {
      void releasePeer(current).catch(() => {
        showNotice("Couldn't finish disconnecting. Please try again.")
      })
    }
  }

  async function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return
    const attempt: Conn = { ...connRef.current, kind: "connecting" }
    let peer: PeerSession | null = null
    setConn(attempt)
    try {
      await finishCleanup()
      if (!isCurrentAttempt(attempt)) return
      startPeer(attempt, false)
      peer = peerRef.current
      await queueSignal(
        attempt,
        "accept",
        undefined,
        () => peerRef.current === peer,
      )
    } catch {
      if (isCurrentAttempt(attempt) || (peer && peerRef.current === peer)) {
        disconnect("Connection request failed. Please try again.")
      }
    }
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return
    void queueSignal(connRef.current, "decline").catch(() => {
      showNotice("Couldn't decline the request. Please try again.")
    })
    setConn({ kind: "idle" })
  }

  function disconnect(message?: string) {
    const c = connRef.current
    if (c.kind === "connecting" || c.kind === "connected") {
      const peer = teardown(message, false)
      if (peer) {
        // Keep the transport for a normal hangup acknowledgement after cleanup.
        void releasePeer(c, peer).catch(() => {
          showNotice("Couldn't finish disconnecting. Please try again.")
        })
      } else {
        // Acceptance was cancelled while waiting for an earlier cleanup.
        void queueSignal(c, "decline").catch(() => {})
      }
      return
    }

    teardown(message)
  }

  function endConnection() {
    disconnect()
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return
    setVideo("requesting")
    peerRef.current.sendControl("video-request")
  }

  function acceptVideo() {
    const ps = peerRef.current
    if (!ps || videoRef.current !== "incoming") return
    const attempt = videoAttemptRef.current
    ps.startVideo()
      .then((stream) => {
        if (!stream || !isCurrentVideoAttempt(ps, attempt)) return
        setLocalStream(stream)
        ps.sendControl("video-accept")
        setVideo("active")
      })
      .catch(() => {
        if (!isCurrentVideoAttempt(ps, attempt)) return
        ps.sendControl("video-decline")
        setVideo("none")
        showNotice("Camera unavailable.")
      })
  }

  function declineVideo() {
    peerRef.current?.stopVideo()
    peerRef.current?.sendControl("video-decline")
    setVideo("none")
  }

  function endVideo() {
    const ps = peerRef.current
    ps?.stopVideo()
    ps?.sendControl("video-end")
    setLocalStream(null)
    setRemoteStream(null)
    setVideo("none")
  }

  function processSignal(sig: SignalMsg) {
    const current = connRef.current
    const matchesCurrentAttempt =
      current.kind !== "idle" &&
      current.peerId === sig.fromId &&
      current.connectionId === sig.connectionId
    if (sig.type !== "request" && !matchesCurrentAttempt) return

    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({
            kind: "incoming",
            peerId: sig.fromId,
            connectionId: sig.connectionId,
          })
        } else if (!matchesCurrentAttempt) {
          void queueSignal(
            { peerId: sig.fromId, connectionId: sig.connectionId },
            "decline",
          ).catch(() => {})
        }
        break
      }
      case "accept": {
        const c = connRef.current
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current)
          requestTimer.current = null
          writtenRequest.current = null
          startPeer(c, true)
          setConn({ ...c, kind: "connecting" })
        }
        break
      }
      case "decline": {
        const c = connRef.current
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (requestTimer.current) clearTimeout(requestTimer.current)
          teardown("Request declined.")
        }
        break
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null
        if (peerRef.current && peerId === sig.fromId) {
          const peer = peerRef.current
          void peer
            .handleSignal(sig.type as DescType, sig.payload ?? "")
            .catch(() => {
              if (peerRef.current === peer) {
                disconnect("Connection request failed. Please try again.")
              }
            })
        }
        break
      }
      case "end": {
        const c = connRef.current
        if (
          (c.kind === "incoming" ||
            c.kind === "requesting" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" })
          else teardown("Stranger disconnected.")
        }
        break
      }
    }
  }

  const processSignalRef = useRef(processSignal)
  const disconnectRef = useRef(disconnect)
  useEffect(() => {
    processSignalRef.current = processSignal
    disconnectRef.current = disconnect
  })

  useEffect(() => {
    if (phase !== "live" || !sessionId) return

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const data = await poll(sessionId)

        if (!active) return

        setPeers(data.peers)
        setPresenceStatus("ready")

        const current = connRef.current
        const hasPeerDisconnected =
          (current.kind === "connecting" || current.kind === "connected") &&
          !data.peers.some((peer) => peer.id === current.peerId)

        if (hasPeerDisconnected) {
          disconnectRef.current("Stranger disconnected.")
        }

        for (const s of data.signals) {
          processSignalRef.current(s)
        }
      } catch {
        if (active) setPresenceStatus("degraded")
      }

      if (active) {
        timer = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }

    tick()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [phase, sessionId])

  useEffect(() => {
    if (!sessionId || phase !== "live") return
    const onLeave = () => leave(sessionId)
    window.addEventListener("pagehide", onLeave)
    window.addEventListener("beforeunload", onLeave)
    return () => {
      window.removeEventListener("pagehide", onLeave)
      window.removeEventListener("beforeunload", onLeave)
    }
  }, [sessionId, phase])

  async function handleReady(lat: number, lng: number) {
    const { id, location } = await join(lat, lng)
    setMyLocation(location)
    setSessionId(id)
    setPhase("live")
  }

  const hasJoined = phase === "live"
  const inChat = conn.kind === "connecting" || conn.kind === "connected"
  const canDiscover = hasJoined && conn.kind === "idle"

  return (
    <main
      className="
        pulse-shell group/shell fixed inset-0 overflow-hidden bg-background
        [--conversation-width:min(400px,calc(100vw-3rem))]
        [--conversation-height:min(70dvh,calc(100dvh-8rem))]
        [--conversation-bottom:max(1rem,env(safe-area-inset-bottom))]
        max-md:data-[video=true]:[--conversation-height:min(80dvh,calc(100dvh-8rem))]
      "
      data-conversation={inChat}
      data-video={video === "active"}
    >
      <WorldMap
        peers={peers}
        me={myLocation}
        onPeerClick={requestConnection}
        interactive={hasJoined}
        canConnect={canDiscover && presenceStatus === "ready"}
      >
        <header
          className="
            pointer-events-none absolute top-[max(1.5rem,env(safe-area-inset-top))] right-4 left-4 z-20
            flex flex-wrap items-center justify-between gap-2 md:right-6 md:left-6 md:gap-4
            md:group-data-[conversation=true]/shell:right-[calc(var(--conversation-width)+3.5rem)]
          "
        >
          <h1 className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-[2rem] leading-[1.1]">
            Pulse
          </h1>
          <div className="pointer-events-auto flex items-center gap-4">
            {hasJoined && (
              <p
                role="status"
                className="text-sm font-medium leading-snug rounded-control bg-surface px-3 py-2.5 shadow-[0_2px_12px_var(--shadow-warm)] md:px-4"
              >
                {presenceStatus === "ready" ? (
                  <>
                    <span className="block text-xs font-normal text-muted">
                      Other people
                    </span>
                    <span>{peers.length} online</span>
                  </>
                ) : presenceStatus === "degraded" ? (
                  "Live updates paused"
                ) : (
                  "Finding people…"
                )}
              </p>
            )}
            <ThemeSelector />
          </div>
        </header>
      </WorldMap>

      {!hasJoined && <EntryGate onReady={handleReady} />}

      {canDiscover && (
        <section
          className="
            pointer-events-none absolute top-24 left-4 z-20 w-[min(300px,calc(100%-2rem))] rounded-panel
            bg-surface p-6 shadow-[0_4px_24px_var(--shadow-warm)] md:left-6
            md:w-[min(300px,calc(100%-3rem))]
          "
          aria-labelledby="discovery-heading"
        >
          <h2
            id="discovery-heading"
            className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-2xl leading-tight"
          >
            {presenceStatus === "degraded"
              ? "Live updates paused"
              : presenceStatus === "loading"
                ? "Finding people…"
                : peers.length === 0
                  ? "A quiet moment on the globe."
                  : "Find your next conversation"}
          </h2>
          <p className="mt-2 text-sm text-muted">
            {presenceStatus === "degraded"
              ? "We couldn't refresh the dots. Retrying automatically; the visible dots may be out of date."
              : presenceStatus === "loading"
                ? "Your dot is ready. We're checking who's here."
                : peers.length === 0
                  ? "No one else is here yet. New dots appear as people join."
                  : "Select an available dot to say hello. A faded dot is already in a conversation."}
          </p>
        </section>
      )}

      {notice && (
        <p
          role="status"
          className="
            text-sm font-medium leading-snug pointer-events-none absolute top-24 left-4 z-40
            max-w-[min(360px,calc(100%-2rem))] rounded-control bg-surface p-4
            shadow-[0_4px_24px_var(--shadow-warm)] md:left-6 md:max-w-[min(360px,calc(100%-3rem))]
          "
        >
          {notice}
        </p>
      )}

      {conn.kind === "requesting" && (
        <section
          className="
            absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-30
            w-[min(360px,calc(100%-2rem))] -translate-x-1/2 rounded-panel bg-surface p-6
            shadow-[0_8px_32px_var(--shadow-warm)]
          "
          aria-labelledby="request-heading"
        >
          <h2
            id="request-heading"
            role="status"
            className="font-heading font-semibold tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'WONK'_0] text-2xl leading-tight"
          >
            Waiting for a response…
          </h2>
          <p className="text-sm font-medium leading-snug mt-3 text-muted">
            You can cancel while you wait.
          </p>
          <button
            onClick={cancelRequest}
            className="
              inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
              px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
              duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
              bg-surface-muted text-foreground mt-4
            "
          >
            Cancel
          </button>
        </section>
      )}

      {conn.kind === "incoming" && (
        <ConnectionPrompt
          title="A stranger wants to connect"
          subtitle="Choose whether you'd like to talk."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <div
          className="
            absolute inset-x-4 bottom-(--conversation-bottom) z-20 flex h-(--conversation-height) min-h-0
            flex-col overflow-hidden rounded-panel bg-surface shadow-[0_8px_32px_var(--shadow-warm)]
            md:top-[max(1.5rem,env(safe-area-inset-top))] md:right-6 md:bottom-6 md:left-auto md:h-auto
            md:w-(--conversation-width)
          "
        >
          {video === "active" && (
            <VideoPanel
              localStream={localStream}
              remoteStream={remoteStream}
              onEnd={endVideo}
            />
          )}
          {video === "requesting" && (
            <p
              role="status"
              className="text-sm font-medium leading-snug shrink-0 bg-surface-muted px-4 py-3"
            >
              Waiting for stranger to accept video…
            </p>
          )}
          <ChatPanel
            messages={messages}
            connected={conn.kind === "connected"}
            videoBusy={video !== "none"}
            onSend={(text) => {
              if (peerRef.current?.sendChat(text)) addMessage(true, text)
              else {
                showNotice(
                  "Message wasn't sent. The connection is unavailable.",
                )
              }
            }}
            onStartVideo={startVideoRequest}
            onEnd={endConnection}
          />
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          title="Start video call?"
          subtitle="Accept to share your camera and microphone. You can return to chat."
          acceptLabel="Accept"
          declineLabel="Decline"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}
    </main>
  )
}
