import type { PeerSession } from "../../lib/webrtc.ts"
import { loadSource } from "./source.mts"

type PeerSessionModule = typeof import("../../lib/webrtc.ts")
export type PeerCallbacks = ConstructorParameters<typeof PeerSession>[1]
type ChannelMessage = Pick<MessageEvent<string>, "data">
type DataChannelEvent = { channel: Channel }
type BrowserGlobals = Record<string, unknown>

class Channel {
  readyState: RTCDataChannelState = "open"
  sent: string[] = []
  onopen?: () => void
  onclose?: () => void
  declare onmessage: (event: ChannelMessage) => void

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = "closed"
    this.onclose?.()
  }
}

// Simulate channel delivery and description/candidate ordering, not native ICE.
export function createRtcHarness(globals: BrowserGlobals = {}) {
  const connections: Connection[] = []

  class Connection {
    channel?: Channel
    remoteDescription: RTCSessionDescriptionInit | null = null
    localDescription: RTCSessionDescriptionInit | null = null
    signalingState: RTCSignalingState = "stable"
    candidates: RTCIceCandidateInit[] = []
    closed = false

    declare ondatachannel: (event: DataChannelEvent) => void

    constructor() {
      connections.push(this)
    }

    createDataChannel() {
      return (this.channel = new Channel())
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit) {
      // Model the browser API's asynchronous description installation.
      await Promise.resolve()

      if (this.closed) {
        throw new Error("Connection closed")
      }

      this.remoteDescription = description
      this.signalingState =
        description.type === "offer" ? "have-remote-offer" : "stable"
    }

    async setLocalDescription() {
      if (this.closed) {
        throw new Error("Connection closed")
      }

      const type = this.remoteDescription?.type === "offer" ? "answer" : "offer"
      this.localDescription = { type, sdp: "test-description" }
      this.signalingState = type === "answer" ? "stable" : "have-local-offer"
    }

    async addIceCandidate(candidate: RTCIceCandidateInit) {
      if (this.closed || !this.remoteDescription) {
        throw new Error("Candidate requires an open connection and description")
      }

      this.candidates.push(candidate)
    }

    close() {
      this.closed = true
      this.signalingState = "closed"
    }
  }

  const { PeerSession } = loadSource<PeerSessionModule>(
    "lib/webrtc.ts",
    {},
    { RTCPeerConnection: Connection, ...globals },
  )

  const createCallbacks = (
    overrides: Partial<PeerCallbacks> = {},
  ): PeerCallbacks => ({
    onSignal() {},
    onChat() {},
    onControl() {},
    onRemoteStream() {},
    onConnectionState() {},
    onChannelOpen() {},
    ...overrides,
  })

  return { PeerSession, connections, Channel, createCallbacks }
}
