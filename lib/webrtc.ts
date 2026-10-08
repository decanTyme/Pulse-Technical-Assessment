export type DescType = "offer" | "answer" | "ice"
export type PeerControl =
  "video-request" | "video-accept" | "video-decline" | "video-end"

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void
  onChat: (text: string) => void
  onControl: (ctrl: PeerControl) => void
  onRemoteStream: (stream: MediaStream | null) => void
  onConnectionState: (state: RTCPeerConnectionState) => void
  onChannelOpen: () => void
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
}

const CHAT_END_TIMEOUT_MS = 3_000

export class PeerSession {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null

  private readonly polite: boolean
  private localStream: MediaStream | null = null
  private closed = false
  private readonly cb: PeerCallbacks
  private pendingCandidates: RTCIceCandidateInit[] = []
  private incomingSignals: Promise<void> = Promise.resolve()
  private remoteEnding = false
  private chatEnd: Promise<void> | null = null
  private completeChatEnd: (() => void) | null = null

  private makingOffer = false
  private ignoreOffer = false

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb
    this.polite = !initiator
    this.pc = new RTCPeerConnection(ICE_CONFIG)

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate))
      }
    }

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true
        await this.pc.setLocalDescription()
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription))
        }
      } finally {
        this.makingOffer = false
      }
    }

    this.pc.ontrack = ({ streams }) => {
      this.cb.onRemoteStream(streams[0] ?? null)
    }

    this.pc.onconnectionstatechange = () => {
      if (!this.closed && !this.remoteEnding && !this.chatEnd) {
        this.cb.onConnectionState(this.pc.connectionState)
      }
    }

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat")
      this.wireDataChannel(this.dc)
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel
        this.wireDataChannel(this.dc)
      }
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      if (!this.closed) this.cb.onChannelOpen()
    }

    dc.onclose = () => {
      if (this.completeChatEnd) {
        this.completeChatEnd()
        return
      }
      // Remote channel closure can precede any peer-connection state change.
      // A graceful hangup is already coordinated; its end arrives through polling.
      if (!this.closed && !this.remoteEnding) {
        this.cb.onConnectionState("closed")
      }
    }

    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string)
        if (msg.t === "chat" && typeof msg.text === "string") {
          this.cb.onChat(msg.text)
        } else if (msg.t === "ctrl" && typeof msg.ctrl === "string") {
          if (msg.ctrl === "chat-end") {
            this.remoteEnding = true
            this.safeSend({ t: "ctrl", ctrl: "chat-end-ack" })
          } else if (msg.ctrl === "chat-end-ack") {
            this.completeChatEnd?.()
          } else {
            this.cb.onControl(msg.ctrl as PeerControl)
          }
        }
      } catch {}
    }
  }

  handleSignal(type: DescType, payload: string): Promise<void> {
    // A poll can deliver several signals before an async description is ready.
    const operation = this.incomingSignals.then(() =>
      this.applySignal(type, payload),
    )

    // Preserve this operation's rejection for its caller without blocking later signals.
    this.incomingSignals = operation.catch(() => {})

    return operation
  }

  private async applySignal(type: DescType, payload: string) {
    if (this.closed) return

    const data = JSON.parse(payload)

    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        this.pendingCandidates.push(data)
        return
      }

      try {
        await this.pc.addIceCandidate(data)
      } catch {}

      return
    }

    const desc = data as RTCSessionDescriptionInit
    const offerCollision =
      desc.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable")

    this.ignoreOffer = !this.polite && offerCollision
    if (this.ignoreOffer) return

    await this.pc.setRemoteDescription(desc)
    if (this.closed) return

    await this.flushPendingCandidates()
    if (this.closed) return

    if (desc.type === "offer") {
      await this.pc.setLocalDescription()
      if (!this.closed && this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription))
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return
    const queued = this.pendingCandidates
    this.pendingCandidates = []
    for (const candidate of queued) {
      if (this.closed) return

      try {
        await this.pc.addIceCandidate(candidate)
      } catch {}
    }
  }

  sendChat(text: string) {
    return this.safeSend({ t: "chat", text })
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl })
  }

  private safeSend(obj: unknown) {
    if (!this.closed && this.dc?.readyState === "open") {
      this.dc.send(JSON.stringify(obj))
      return true
    }

    return false
  }

  async startVideo(): Promise<MediaStream> {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      for (const track of this.localStream.getTracks()) {
        this.pc.addTrack(track, this.localStream)
      }
    }
    return this.localStream
  }

  stopVideo() {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop()
      for (const sender of this.pc.getSenders()) {
        if (sender.track) {
          try {
            this.pc.removeTrack(sender)
          } catch {}
        }
      }
      this.localStream = null
    }
  }

  // Call only after end coordination succeeds. Wait for delivery acknowledgement
  // before closing the transport, so normal hangup does not trigger a second end.
  endChat(): Promise<void> {
    if (this.chatEnd) return this.chatEnd
    if (this.closed || this.dc?.readyState !== "open") {
      this.close()
      return Promise.resolve()
    }

    this.chatEnd = new Promise((resolve) => {
      const timer = setTimeout(
        () => this.completeChatEnd?.(),
        CHAT_END_TIMEOUT_MS,
      )

      this.completeChatEnd = () => {
        clearTimeout(timer)
        this.completeChatEnd = null
        this.close()
        resolve()
      }

      try {
        if (!this.safeSend({ t: "ctrl", ctrl: "chat-end" })) {
          this.completeChatEnd()
        }
      } catch {
        this.completeChatEnd()
      }
    })
    return this.chatEnd
  }

  close() {
    if (this.closed) return
    if (this.completeChatEnd) {
      this.completeChatEnd()
      return
    }

    this.closed = true
    this.pendingCandidates = []
    this.stopVideo()

    if (this.dc) {
      try {
        this.dc.close()
      } catch {}
    }
    try {
      this.pc.close()
    } catch {}
  }
}
