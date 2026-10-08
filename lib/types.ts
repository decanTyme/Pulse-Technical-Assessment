// Shared types across client + API.

// Signal mailbox message types.
export type SignalType =
  | "request" // connection request (tap a dot)
  | "accept" // recipient accepted
  | "decline" // recipient declined (or auto-declined while busy)
  | "offer" // WebRTC SDP offer
  | "answer" // WebRTC SDP answer
  | "ice" // WebRTC ICE candidate
  | "end" // hang up / leave the connection

export interface MapLocation {
  lat: number
  lng: number
}

export interface PeerDot extends MapLocation {
  id: string
  busy: boolean
  status: string | null
}

export interface SignalData {
  fromId: string
  toId: string
  connectionId: string
  type: SignalType
  payload: string | null
}

export interface SignalMsg extends SignalData {
  id: string
  createdAt: string
}

export interface PollResponse {
  peers: PeerDot[]
  signals: SignalMsg[]
}
