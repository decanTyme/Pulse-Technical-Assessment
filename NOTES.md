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

As additional failure/race scenarios grew, I deferred them and scoped the automated browser baseline to Chromium after repeated Firefox connection-readiness failures. This reserved time for security and release verification. The open acceptance-recovery defect remains documented below. One retry helps gather evidence, but a test passing only on retry still fails the run.

Recorded validation: **29 Node regression checks passed**, the production build succeeded, and **all 18 Chromium core journeys passed on their first attempts**. These counts describe the checks actually run. See [focused test boundaries](tests/unit/README.md) and [browser coverage](tests/e2e/README.md).

### Database and tooling decisions

I retained the starter's Prisma ORM and `pg` adapter to keep setup changes focused. Singapore places the database near local development/testing. Planned Vercel functions in Singapore (`sin1`) keep the deployed API close to the database, particularly relevant to polling's sequential queries. [Vercel region guidance](https://vercel.com/docs/functions/configuring-functions/region), [region codes](https://vercel.com/docs/regions).

The pairing fits Neon Free and Vercel Hobby within their usage limits; Hobby supports one selected function region. [Neon free-tier regions](https://neon.com/blog/making-pricing-more-predictable), [Vercel region limits](https://vercel.com/docs/functions/configuring-functions/region#limits).

Local entry completes in under one second and signaling requests in under 100 ms. These are development observations without a controlled benchmark. Prettier uses two-space indentation and no semicolons.

### Remaining limitations

- Automated coverage establishes the Chromium baseline. Synthetic locations/media and intercepted map downloads leave real Mapbox configuration, hardware permissions, cross-browser and cross-network behavior for separate verification.
- **Open recovery defect:** when the server stores an `accept` signal but its HTTP response fails, cleanup can remove that signal before the requester polls. The requester can remain in the `requesting` state after receiving an `end` signal, blocking a replacement request. Deferring its fault-injection test does not resolve it.
- Vercel project setup, environment configuration, deployed function region, and an HTTPS two-participant smoke test remain pending. The local baseline alone does not establish deployment readiness.

## Phase 2: Make it good

Pending. No visual redesign has been selected or implemented.

## Phase 3: Make it secure

Input validation is implemented for `/api/join` and `/api/signal`. The broader API security review, risk prioritization, and release fixes remain pending.

## Phase 4: Make it better

Pending. No additional feature has been selected or implemented.
