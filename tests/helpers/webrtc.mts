import type { PeerSession } from "../../lib/webrtc.ts"
import { loadSource } from "./source.mts"

type PeerSessionModule = typeof import("../../lib/webrtc.ts")
export type PeerCallbacks = ConstructorParameters<typeof PeerSession>[1]
type ChannelMessage = Pick<MessageEvent<string>, "data">
type DataChannelEvent = { channel: Channel }

class Channel {
  readyState: RTCDataChannelState = "open"
  sent: string[] = []
  declare onmessage: (event: ChannelMessage) => void

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = "closed"
  }
}

// Only the peer/channel behavior needed for chat tests is simulated here.
export function createRtcHarness() {
  const connections: Connection[] = []

  class Connection {
    channel?: Channel
    declare ondatachannel: (event: DataChannelEvent) => void

    constructor() {
      connections.push(this)
    }

    createDataChannel() {
      return (this.channel = new Channel())
    }

    close() {}
  }

  const { PeerSession } = loadSource<PeerSessionModule>(
    "lib/webrtc.ts",
    {},
    { RTCPeerConnection: Connection },
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
