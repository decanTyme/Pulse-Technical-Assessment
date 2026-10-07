import assert from "node:assert/strict"
import test from "node:test"

import { createRtcHarness } from "../helpers/webrtc.mts"

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
