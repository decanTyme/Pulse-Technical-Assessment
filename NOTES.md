# Assessment notes

## Delivery priorities and AI-assisted work

I set a deploy-ready baseline as the first milestone: working core journeys, prioritized API security fixes, and production/deployment verification. The next priority after the browser baseline is the API security review. Visual redesign and an additional feature remain part of the assessment, sequenced after that milestone.

I used Codex for repository tracing, documentation research, implementation drafts, and regression tests. I asked for research findings before implementing unfamiliar pieces and for file references and explanations when reviewing changes. I challenged proposals that added more infrastructure or test scope than the assessment needed. Related fixes and regression coverage were kept together for review; the milestones determined the order of work.

## Phase 1: Make it run

### Establishing the local baseline

1. Cloned the starter and retained its Git history.
2. Installed dependencies and configured an ignored `.env` from `.env.example` with `DATABASE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN`.
3. Created a Neon PostgreSQL database in AWS Singapore (`aws-ap-southeast-1`).
4. Ran `npx prisma db push` to synchronize the coordination schema.
5. Ran `npx prisma generate` to create the client.
6. Started the app with `npm run dev`.

The first API calls failed with `Cannot find module '.prisma/client/default'`; TypeScript reported `Module '"@prisma/client"' has no exported member 'PrismaClient'.` The starter [README](README.md#local-setup) omitted `npx prisma generate`, which Prisma 7 no longer runs automatically after `db push`. That left an onboarding gap: the database was synchronized, but the schema-specific client code and TypeScript types were missing. Running generation resolved both errors. The production build already includes this step; local development needs it explicitly. [Prisma 7 CLI behavior](https://docs.prisma.io/docs/cli/v7/db/push). A working globe was the starting point for two-participant testing.

### Investigation and fixes

- **Abandoned dots:** browser checks showed that an abandoned participant remained visible while another kept polling. Tracing [polling](app/api/poll/route.ts) showed that every session's heartbeat was refreshed. The fix updates only the `lastSeen` timestamp for the session making the poll request, allowing abandoned sessions to expire. The regression test keeps one participant polling while the other stops, then checks that the abandoned participant's dot disappears.
- **Chat and negotiation:** a browser test reached chat but failed to display a message on the recipient. The sender and receiver used different message discriminators. `PeerSession` in [lib/webrtc.ts](lib/webrtc.ts) now uses a consistent discriminator, and local echo follows a successful send on an open channel. Research also established that ICE candidates require a remote description: incoming signals are now ordered, and early candidates wait for that prerequisite. This addresses an application ordering defect; it does not diagnose every ICE failure. [WebRTC candidate prerequisites](https://w3c.github.io/webrtc-pc/#dom-peerconnection-addicecandidate).
- **End and reconnect:** traces showed a departed dot disappearing while the other chat stayed open, and a replacement request being declined while cleanup was still in flight. The investigation covered both browser state and server reservations. [Signaling](app/api/signal/route.ts) now updates `busy` flags and stores the matching `accept` or `end` signal in one database transaction. Handling an `end` signal removes obsolete signaling messages between the two participants; handling `decline` leaves reservations for unrelated active conversations unchanged. `Home` in [app/page.tsx](app/page.tsx) orders outgoing writes and waits for successful cleanup before another attempt. Channel closure or a peer disappearing from a successful poll ends the surviving chat. Using the **End** button cleans up server state before sending a hangup message and waiting up to three seconds for acknowledgement. This avoids duplicate cleanup during normal hangup that could erase a later connection request.
- **Stalled or failed coordination:** slow signaling and failed writes made connection feedback unreliable. [The API client](lib/api.ts) now rejects unsuccessful HTTP responses and stops waiting after 15 seconds. [The database client](lib/prisma.ts) bounds connection/query waits to five seconds and makes Prisma's transaction limits explicit. I kept these as operation limits: multiple queries can exceed five seconds, and cancelling client waiting does not prove that a server write or SQL was cancelled. [node-postgres options](https://node-postgres.com/apis/client), [Prisma transaction options](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions).
- **Request validation:** I asked for research on Next.js route-validation wrappers before choosing direct Zod 4 schemas. Zod was already installed, and route-owned schemas kept the validation and responses easy to follow. A shared [JSON reader](lib/request.ts) was justified by duplicate parsing/error handling in `/api/join` and `/api/signal`. The refactor preserves existing input limits and returns fixed HTTP 400 messages without echoing submitted content. Authorization and deeper payload hardening remain security-review work.

### Choosing the testing scope

I asked for browser journeys derived from [the requirements](docs/requirements.md): entry/exploration, connection consent, bidirectional messages, video, end/reconnect, and departure/fresh sessions. Playwright runs a fresh production build against an isolated schema-only test database, with actual API routes, Prisma/PostgreSQL, and native WebRTC.

The initial failing journeys established a behavioral baseline and gave the agent concrete outcomes to work toward. They also provided regression checks for subsequent fixes. I then used focused tests to guide and verify individual changes.

I challenged tests tied to private page state and exact operation traces. Page journeys now assert browser-visible outcomes; focused route/API/peer-session regressions use controlled external dependencies where failures can be isolated. Node's built-in runner executes the TypeScript tests without adding another test framework.

As additional failure/race scenarios grew, I deferred them and scoped the automated browser baseline to Chromium after repeated Firefox connection-readiness failures. This reserved time for security and release verification. The acceptance-recovery verification gap remains documented below. One retry helps gather evidence, but a test passing only on retry still fails the run.

Recorded validation: **29 Node regression checks passed**, the production build succeeded, and **all 18 Chromium core journeys passed on their first attempts**. These counts describe the checks actually run. See [focused test boundaries](tests/unit/README.md) and [browser coverage](tests/e2e/README.md).

### Database and tooling decisions

I retained the starter's Prisma ORM and `pg` adapter to keep setup changes focused. Singapore places the database near local development/testing. Planned Vercel functions in Singapore (`sin1`) keep the deployed API close to the database, particularly relevant to polling's sequential queries. [Vercel region guidance](https://vercel.com/docs/functions/configuring-functions/region), [region codes](https://vercel.com/docs/regions).

The pairing fits Neon Free and Vercel Hobby within their usage limits; Hobby supports one selected function region. [Neon free-tier regions](https://neon.com/blog/making-pricing-more-predictable), [Vercel region limits](https://vercel.com/docs/functions/configuring-functions/region#limits).

Local entry completes in under one second and signaling requests in under 100 ms. These are development observations without a controlled benchmark. Prettier uses two-space indentation and no semicolons.

### Remaining limitations

- Automated coverage establishes the Chromium baseline. Synthetic locations/media and intercepted map downloads leave real Mapbox configuration, hardware permissions, cross-browser and cross-network behavior for separate verification.
- **Acceptance-recovery verification:** the previously reproduced lost-acceptance-response case exposed a requester that ignored an `end` signal while still waiting. Matching `end` signals now also reset the `requesting` state. Its deferred fault-injection scenario has not been rerun, so ordinary End/reconnect success does not establish recovery from that response loss.
- Vercel project setup, environment configuration, deployed function region, and an HTTPS two-participant smoke test remain pending. The local baseline alone does not establish deployment readiness.

## Phase 2: Make it good

Pending. No visual redesign has been selected or implemented.

## Phase 3: Make it secure

Input validation is implemented for `/api/join` and `/api/signal`. I started the security phase with a read-only review before selecting fixes. The [initial security triage](docs/security_best_practices_report.md) prioritizes session ownership, server-side connection consent, and cancellation of pending camera/microphone acquisition for the deploy-ready baseline. Bounded API inputs/abuse controls and accurate privacy wording are also baseline work; the report records remaining hardening and configuration checks separately. The dependency audit reported zero known vulnerabilities. Session ownership and server-side connection consent are implemented; the other baseline controls remain pending.

### Private session ownership

The first authorization regression reproduced a mailbox being read and consumed using only its public dot ID. I prioritized this because every participant receives other dot IDs during ordinary polling. Unpredictable public UUIDs cannot prove ownership once they are shared.

[Join](app/api/join/route.ts) now creates a fresh public UUID and a separate private token with 256 bits of cryptographic randomness. It ignores submitted IDs rather than overwriting an existing presence. [The ownership helper](lib/session.ts) verifies a token against its SHA-256 hash in PostgreSQL before polling, signaling, or departure can touch that session's data. Peer responses expose neither tokens nor hashes. This follows [OWASP's session-token guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-id-entropy).

[The API client](lib/api.ts) keeps the token in page memory to preserve fresh per-tab sessions. Normal requests carry it in the `Authorization` header; the departure beacon carries it in its JSON body because `sendBeacon` cannot set that header. Credentials stay out of URLs and persistent browser storage. HTTPS is required outside local development, and anyone who obtains the token can act as that session until its presence is removed.

I kept entry recovery small: the client reports a fixed error for network, HTTP, JSON parsing, or credential-validation failures, and [the entry screen](app/components/EntryGate.tsx) awaits the join callback, displays a retry message, and re-enables the button. Credentials are installed only after a valid response. The browser regression forces the first join to fail before any server write, then enters the globe through the real API on a deliberate retry; it does not automatically repeat join writes.

The additive schema change stores a nullable hash so existing rows remain intact but cannot authenticate; existing participants must re-enter. Ownership proves which participant is acting; the connection checks below separately establish the recipient's consent and the current pair.

Verification: **36 Node regression checks passed**, the production build and TypeScript check succeeded, and **all 19 Chromium checks passed on their first attempts**. The new real API/database regression verifies denied mailbox access, impersonation and deletion, then confirms the owner's queued request survives. Existing chat, video, reconnect and tab-close journeys remain green.

Entry-recovery validation: **37 Node checks** and **all five focused Chromium entry/ownership checks passed**, including the new failed-entry/retry regression. The production build, TypeScript, and scoped lint checks passed. The full browser suite was not repeated for this follow-up.

### Connection consent and attempt cleanup

The first focused regression reproduced an `accept` without a pending request reserving both participants. A valid session token proved the sender's identity but did not authorize that connection. I kept the fix within the existing coordination store: [connection rules](lib/coordination.ts) record each participant's current peer, request initiator, attempt ID, and request time on `Presence`. There is no connection-history table or additional service. One pending interaction per participant matches the existing interface; pending requests expire after 30 seconds.

Only the intended recipient can accept or decline the matching pending request. SDP/ICE signaling requires both participants to belong to that accepted pair. A fresh UUID from [the page](app/page.tsx) identifies each attempt and travels with its signals; it is a correlation ID, while the private token still authorizes the acting session. Old or unrelated controls cannot release a different attempt. The browser also ignores controls that do not match its current peer and attempt.

Admission, acceptance, cleanup, and their mailbox messages use one serializable database transaction per transition. Competing changes can produce a write conflict; the helper retries only Prisma's `P2034` rollback error, with at most three attempts. It does not automatically replay a write after a transport failure with an uncertain commit outcome. This follows [Prisma's concurrency guidance](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#transaction-timing-issues) and [OWASP's server-side workflow guidance](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html#preventing-out-of-order-api-execution).

Leaving or stale-session removal releases the matching partner and notifies it in the same transaction. Expiry notifies both participants. Repeated `end` calls for an absent or older attempt are harmless successful no-ops, supporting cleanup after a lost acknowledgement without clearing a replacement reservation. Matching `end` signals also return a waiting requester to idle. Heartbeats and public map reads remain outside these serializable transitions.

The [migration](prisma/migrations/20261008010000_connection_consent/migration.sql) adds five nullable columns and two indexes, preserving existing rows. Development and isolated test schemas were synchronized without resets or data-loss flags. Existing participants should re-enter; legacy signals without an attempt ID are drained without delivery.

Verification: **all 41 Node checks passed**, and **all 22 Chromium checks passed on their first attempts** against the production build. The latter includes 19 browser journeys and three real API/PostgreSQL checks. [Consent regressions](tests/e2e/consent.spec.ts) exercise competing requests, duplicate acceptances, third-participant controls, and obsolete attempts through HTTP. These verify selected concurrency scenarios, not every interleaving or a load guarantee. TypeScript and scoped source lint checks passed. Broader delayed-response recovery remains deferred.

## Phase 4: Make it better

Pending. No additional feature has been selected or implemented.
