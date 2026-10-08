# Assessment notes

## Delivery priorities

I set deployment readiness as the first milestone: reliable core journeys, prioritized API security fixes, and production/deployment verification. I sequenced visual redesign and additional features after that baseline to concentrate the available time on functionality and safe release.

## Phase 1: Make it run

### Local setup

1. Cloned the starter repository and retained its existing Git history.
2. Installed the starter dependencies and configured a local `.env` from `.env.example` with `DATABASE_URL` and `NEXT_PUBLIC_MAPBOX_TOKEN`. Credential values remain outside Git.
3. Created a Neon PostgreSQL database in AWS Asia Pacific (Singapore), `aws-ap-southeast-1`.
4. Ran `npx prisma db push` to synchronize the coordination schema.
5. Ran `npx prisma generate` to create the database client required by the application.
6. Started the application with `npm run dev`.

### Setup diagnosis and verification

- API routes initially failed with `Cannot find module '.prisma/client/default'`, and TypeScript reported that `@prisma/client` had no `PrismaClient` export. Prisma 7 no longer generates the client automatically during `db push`; explicit generation resolved the missing-client blocker. The existing production build script already includes generation. [Prisma CLI reference](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#db-push)
- After client generation, the globe loads and responds to interaction, and polling appears to run locally. The development log shows `GET /` returning HTTP 200.
- Local development observations with the Singapore database: app entry completes in under one second and `/api/signal` requests complete in under 100 ms. No controlled benchmark has been run.
- Local startup alone does not establish core functionality; browser verification results are recorded below.

### Development tooling

- Configured Prettier with two-space indentation and no semicolons for consistent formatting.

### Functional fixes

- Set 5-second `pg` connection-acquisition and query-response limits for short coordination operations. Made Prisma's existing interactive transaction limits explicit: 2 seconds to acquire a transaction and 5 seconds to run it. These are per-operation limits; a route with several queries can take longer. The query-response limit bounds client waiting and does not guarantee cancellation of SQL already running. [node-postgres configuration](https://node-postgres.com/apis/client), [Prisma 7 transaction options](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#interactive-transactions)
- Chat sender and receiver now use the same message discriminator, and the UI adds a local message only when the open data channel accepts the send.
- Incoming WebRTC signals are processed in arrival order, and early ICE candidates are applied after the remote description is installed. Previously, early candidates could be silently lost, including when an offer and ICE arrived in one poll. Closing a session skips queued incoming work. [WebRTC candidate prerequisites](https://w3c.github.io/webrtc-pc/#dom-peerconnection-addicecandidate)
- Remote data-channel closure and a connected peer disappearing from a successful poll now end the local chat and send end coordination to release the surviving reservation. Closed sessions and old peer callbacks cannot reopen the chat. [WebRTC data-channel closure](https://w3c.github.io/webrtc-pc/#event-datachannel-close)
- Outgoing coordination writes are ordered. Cancel/end waits for an in-flight write, and a new request or acceptance waits for successful reservation cleanup. Failed cleanup stays pending; a new attempt retries cleanup before writing another request. Failed request/accept writes now end the affected attempt. Failures delivering WebRTC signals or applying a received description use the same cleanup path.
- Signaling checks HTTP success and aborts a stalled client fetch after 15 seconds. Aborting the fetch does not prove that a server write was cancelled. [Fetch error and cancellation behavior](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)
- Normal End releases the server reservation before closing the transport. A small data-channel hangup/acknowledgement exchange prevents the recipient from echoing a second cleanup that could erase a new request. The acknowledgement wait falls back to closing after 3 seconds; the recipient consumes the server's end signal through polling. Abrupt departure keeps the channel-close/poll fallback. Buffered messages can be discarded during closure, so the normal path waits for acknowledgement rather than assuming a final message was delivered. [Data-channel closure behavior](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/close)
- Polling now refreshes only the caller's heartbeat. Previously, one active participant kept abandoned dots alive by refreshing every session.
- Accept/end coordination updates both busy flags and writes its signal in one transaction. End removes older signals between the pair; decline preserves an unrelated active reservation.
- Join and signal request validation use Zod 4's `JoinBodySchema` and `SignalBodySchema`, removing manual request casts. Join preserves the 8–64 UTF-16-unit ID limit and requires finite numeric coordinates within latitude ±90 and longitude ±180. Signal preserves its 65,536 UTF-16-unit payload limit and null normalization. Fixed HTTP 400 errors keep submitted content out of responses. Both routes share a small JSON-reading helper and own their validation and responses.

### Focused regression testing

- Added `npm test` using Node's built-in runner, with no additional testing dependency. Tests and helpers use `.mts` TypeScript modules, run directly on Node 24.12+, and are checked by the existing strict TypeScript project. The existing compiler transforms application TypeScript for the harness. All **29 checks pass**. Tests execute join, polling, and signaling handlers with controlled database boundaries, including request validation, reservation rollback, and cleanup. JSON-reading checks use native Requests; join and signal validation use real Zod. Join tests replace the privacy-offset calculation to verify that only returned offset coordinates enter the database write. Peer-session checks verify chat message compatibility, send readiness, incoming description/candidate ordering, channel-close handling, and bounded hangup acknowledgement with controlled WebRTC boundaries. API checks cover HTTP errors and fetch cancellation. These checks do not prove real database transactions, offset geometry, native ICE, or media transport. See [test scope](tests/unit/README.md).
- Deferred additional coordination failure/race browser scenarios while validating the core business journeys. Their earlier results remain diagnostic evidence; the core suite retains consent, chat/video, disconnect/reconnect, presence and privacy coverage.
- Separate local probes using the real Prisma/pg client timed out after approximately 5 seconds when a TCP peer withheld the connection handshake or query response. These probes used a local simulated peer, with no Neon connection; live database outage and cold-start behavior remain unverified.

### Automated browser testing

- The latest full run passed all **18 Chromium core scenarios on their first attempts** against a fresh production build. It covered entry, map/presence/privacy, connection consent, bidirectional chat, video consent and return to chat, End/reconnect, and connected-tab departure. The same run also included Firefox, whose nine connection-dependent scenarios failed initial data-channel readiness on both attempts. Cross-network and deployment readiness remain separate checks.
- I scoped automated browser coverage to Chromium for this assessment to establish a bounded core baseline and prioritize security and release verification. Firefox testing is deferred after repeated connection-readiness failures; cross-browser compatibility is not claimed.
- A browser trace reproduced a tab-close bug: the departed dot vanished, but the surviving chat stayed connected. Another trace reproduced a new request being auto-declined while both participants' end writes were still in flight. An earlier focused Chromium run passed delayed End/reconnect, cancellation of an in-flight request, and tab-close followed by a new chat. Each scenario requires successful message delivery after reconnecting. Normal End also asserts that the other browser sends no mirrored end write. Those three Firefox checks failed at data-channel readiness.
- An earlier focused production run covered live failed request, failed acceptance, and failed-cleanup retry/cancellation: **2 Chromium passes, 1 Chromium failure; 3 Firefox failures**. Failed acceptance prevents the replacement request from opening an incoming prompt in both browsers. The real write commits before an injected error response; cleanup removes acceptance before the initiator polls it, and the initiator remains requesting despite receiving end. Firefox's other two cases passed coordination recovery but stopped at data-channel readiness, leaving message delivery unverified. These are historical focused checks; the additional failure scenarios are now deferred. Deployment readiness is not established.

- Added Playwright 1.63.0 with one configuration and a Chromium project. `npm run test:e2e` runs 18 scenarios against a production build, grouped into entry, presence/map, connections/chat, and video specs. It reads the isolated test database's `DATABASE_URL` only from ignored `.env.test.local`; Zod 4 validates the URL, and a guard rejects the known development database.
- All three Chromium entry checks pass locally; see [test setup and limitations](tests/e2e/README.md).
- The browser baseline before these functional fixes produced **16 passes and 20 failures** across all 36 checks. Eighteen failures stopped at the connection-readiness prerequisite, leaving their later assertions unverified; two reproduced stale-dot persistence. That historical run predates the current Chromium baseline. Per-session cleanup left the test database empty.
- Derived six critical user journeys from [the business requirements](docs/requirements.md): enter/explore, request consent, exchange messages, video, end/reconnect, and leave/start fresh. Added checks for ignored requests, a third participant requesting a busy peer, new session IDs/privacy offsets, map gestures, video decline, media-permission failures, and closing a connected tab. Video scenarios exercise either initiator and the other participant ending the call. See [coverage and boundaries](tests/e2e/README.md).
- The two-participant scenarios use real API routes, Prisma/PostgreSQL, and WebRTC, with synthetic locations and media devices. Entry errors are injected to verify the UI response. Mapbox's SDK uses a local blank style, so real tiles/token validity, native permission dialogs, hardware permissions, cross-network connectivity, and deployment remain separate checks.
- Tests build production code in the normal `.next` directory and start a fresh server at `http://localhost:3000`; stop the development server before running them. One worker, explicit per-session cleanup, and ignored artifacts keep runs isolated. One automatic retry is enabled; tests that pass only on retry still fail the run. See [test setup and debugging](tests/e2e/README.md).

### Database and deployment decisions

- Selected Neon Singapore (`aws-ap-southeast-1`) to keep the database near the development and testing environment and limit network delay during local debugging. [Neon regions](https://neon.com/docs/introduction/regions)
- Planned Vercel functions in Singapore (`sin1`) to keep the deployed API close to the database. This is particularly relevant to polling, which performs several sequential database operations. [Vercel function regions](https://vercel.com/docs/functions/configuring-functions/region), [Vercel regions](https://vercel.com/docs/regions)
- This pairing is available on Neon Free and Vercel Hobby within their usage limits. Hobby supports one chosen function region. [Neon free-tier availability](https://neon.com/blog/making-pricing-more-predictable), [Vercel region configuration](https://vercel.com/docs/project-configuration/vercel-json#regions)
- Retained the starter's Prisma ORM and `pg` adapter to keep setup changes focused.
- Vercel project creation, deployment, environment-variable configuration, and the actual deployed function region remain pending.

## Phase 2: Make it good

Pending. No visual direction has been selected or implemented.

## Phase 3: Make it secure

Pending. No security changes have been implemented.

## Phase 4: Make it better

Pending. No additional feature has been selected or implemented.
