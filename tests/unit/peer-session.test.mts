import assert from "node:assert/strict"
import test from "node:test"

import { createRtcHarness } from "../helpers/webrtc.mts"

const candidate: RTCIceCandidateInit = {
  candidate: "test-candidate",
  sdpMid: "0",
}

const offer: RTCSessionDescriptionInit = {
  type: "offer",
  sdp: "test-description",
}

test("chat sent by one session reaches the other session's chat callback", () => {
  const rtc = createRtcHarness()

  const received: string[] = []
  const sender = new rtc.PeerSession(true, rtc.createCallbacks())

  new rtc.PeerSession(
    false,
    rtc.createCallbacks({ onChat: (text) => received.push(text) }),
  )

  const channel = new rtc.Channel()
  rtc.connections[1].ondatachannel({ channel })

  const sent = sender.sendChat("Hello")
  channel.onmessage({ data: rtc.connections[0].channel!.sent[0] })

  assert.deepEqual(received, ["Hello"])
  assert.equal(sent, true)
})

test("chat reports failure without sending on unavailable or closed channels", () => {
  const rtc = createRtcHarness()
  const sender = new rtc.PeerSession(true, rtc.createCallbacks())
  const channel = rtc.connections[0].channel!

  const unavailableStates: RTCDataChannelState[] = [
    "connecting",
    "closing",
    "closed",
  ]

  for (const state of unavailableStates) {
    channel.readyState = state
    assert.equal(sender.sendChat("Not ready"), false)
    assert.deepEqual(channel.sent, [])
  }

  channel.readyState = "open"
  sender.close()
  assert.equal(sender.sendChat("Already closed"), false)
  assert.deepEqual(channel.sent, [])

  const receiver = new rtc.PeerSession(false, rtc.createCallbacks())
  assert.equal(receiver.sendChat("No channel yet"), false)
})

test("ICE received before the offer is applied after the remote description", async () => {
  const rtc = createRtcHarness()
  const session = new rtc.PeerSession(false, rtc.createCallbacks())
  const connection = rtc.connections[0]

  await session.handleSignal("ice", JSON.stringify(candidate))
  assert.equal(connection.candidates.length, 0)
  await session.handleSignal("offer", JSON.stringify(offer))

  // Parsed payload objects originate in the application VM.
  assert.deepEqual(structuredClone(connection.candidates), [candidate])
})

test("ICE delivered with an offer is retained until the description is ready", async () => {
  const rtc = createRtcHarness()
  const session = new rtc.PeerSession(false, rtc.createCallbacks())
  const connection = rtc.connections[0]

  await Promise.all([
    session.handleSignal("offer", JSON.stringify(offer)),
    session.handleSignal("ice", JSON.stringify(candidate)),
  ])

  assert.deepEqual(structuredClone(connection.candidates), [candidate])
})

test("signals received just before closing cannot establish a closed session", async () => {
  const rtc = createRtcHarness()
  const session = new rtc.PeerSession(false, rtc.createCallbacks())
  const connection = rtc.connections[0]

  const work = [
    session.handleSignal("offer", JSON.stringify(offer)),
    session.handleSignal("ice", JSON.stringify(candidate)),
  ]

  session.close()
  await Promise.all(work)

  assert.equal(connection.localDescription, null)
  assert.equal(connection.remoteDescription, null)
  assert.equal(connection.closed, true)
})

test("a rejected signal remains observable and does not block later signals", async () => {
  const rtc = createRtcHarness()
  const session = new rtc.PeerSession(false, rtc.createCallbacks())

  const malformed = session.handleSignal("offer", "{")
  const valid = session.handleSignal("offer", JSON.stringify(offer))

  // Application exceptions originate in the VM, so compare their name.
  await assert.rejects(malformed, { name: "SyntaxError" })
  await valid

  assert.equal(rtc.connections[0].remoteDescription?.type, offer.type)
  assert.equal(rtc.connections[0].remoteDescription?.sdp, offer.sdp)
  assert.equal(rtc.connections[0].localDescription?.type, "answer")
})

test("remote data-channel closure reports that the session ended", () => {
  const rtc = createRtcHarness()
  const states: RTCPeerConnectionState[] = []

  new rtc.PeerSession(
    true,
    rtc.createCallbacks({ onConnectionState: (state) => states.push(state) }),
  )

  rtc.connections[0].channel!.close()

  assert.deepEqual(states, ["closed"])
})

test("local teardown does not report a remote disconnection", () => {
  const rtc = createRtcHarness()
  const states: RTCPeerConnectionState[] = []

  const session = new rtc.PeerSession(
    true,
    rtc.createCallbacks({ onConnectionState: (state) => states.push(state) }),
  )

  session.close()

  assert.deepEqual(states, [])
})

test("a delayed channel-open event cannot reopen a closed session", () => {
  const rtc = createRtcHarness()
  let opened = 0

  const session = new rtc.PeerSession(
    true,
    rtc.createCallbacks({
      onChannelOpen() {
        opened++
      },
    }),
  )

  session.close()
  rtc.connections[0].channel!.onopen?.()

  assert.equal(opened, 0)
})

test("normal hangup waits for acknowledgement and does not echo remote cleanup", async () => {
  const rtc = createRtcHarness()
  const states: RTCPeerConnectionState[] = []

  const sender = new rtc.PeerSession(true, rtc.createCallbacks())
  const receiver = new rtc.PeerSession(
    false,
    rtc.createCallbacks({
      onConnectionState: (state) => states.push(state),
    }),
  )

  const senderChannel = rtc.connections[0].channel!
  const receiverChannel = new rtc.Channel()
  rtc.connections[1].ondatachannel({ channel: receiverChannel })

  const ending = sender.endChat()
  assert.equal(rtc.connections[0].closed, false)
  receiverChannel.onmessage({ data: senderChannel.sent[0] })
  assert.equal(rtc.connections[1].closed, false)
  senderChannel.onmessage({ data: receiverChannel.sent[0] })
  await ending
  receiverChannel.close()
  assert.equal(rtc.connections[0].closed, true)
  assert.deepEqual(states, [])

  // Home closes the receiver when it consumes the already-written end signal.
  receiver.close()
})

test("closing while awaiting hangup acknowledgement settles the pending operation", async () => {
  const rtc = createRtcHarness()

  const session = new rtc.PeerSession(true, rtc.createCallbacks())
  const ending = session.endChat()

  session.close()
  await ending
  assert.equal(rtc.connections[0].closed, true)
})

test("hangup stops waiting and closes if its acknowledgement never arrives", async () => {
  let expire!: () => void
  let cleared = false

  const rtc = createRtcHarness({
    setTimeout(callback: () => void, delay: number) {
      assert.equal(delay, 3_000)
      expire = callback
      return 1
    },
    clearTimeout() {
      cleared = true
    },
  })

  const session = new rtc.PeerSession(true, rtc.createCallbacks())
  const ending = session.endChat()

  expire()
  await ending
  assert.equal(rtc.connections[0].closed, true)
  assert.equal(cleared, true)
})
