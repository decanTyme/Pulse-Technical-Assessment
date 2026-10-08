# Assessment notes

[Live app](https://pulse-technical-assessment-red.vercel.app/)

I used Codex for investigation, research, implementation and tests, while reviewing decisions, requesting explanations and narrowing proposals that exceeded the assessment's scope. I prioritized core journeys and the highest-impact security fixes before redesign.

## Phase 1: Make it run

- **Onboarding:** the documented setup produced `Cannot find module '.prisma/client/default'` and a missing `PrismaClient` export. Prisma 7 no longer generates the client during `db push`; explicitly running `npx prisma generate` resolved this README gap.
- **Presence:** two-participant testing exposed abandoned dots kept alive by another participant's polling. [Polling](app/api/poll/route.ts) now refreshes only the requesting session's `lastSeen`.
- **Chat and reconnect:** browser journeys exposed mismatched chat message types, premature ICE handling and cleanup races. [WebRTC](lib/webrtc.ts) now uses consistent message types and queues candidates until a remote description exists. [Connection handling](app/page.tsx) orders writes and completes cleanup before retrying; departure ends the surviving chat.
- **Coordination:** unsuccessful HTTP responses now fail explicitly, client waits are bounded, and direct Zod schemas reject malformed requests. Neon and Vercel functions use Singapore: close to local development and colocated for database-heavy polling.
- **Verification:** requirements-based Playwright journeys established the failing baseline using real routes, an isolated PostgreSQL database and native WebRTC. Focused TypeScript tests use Node's runner. The conversation-layout baseline passed **44 Node checks and 25 Chromium checks**, with a fresh production build and no browser retries; later styling received targeted checks. Chromium is the assessment baseline; hardware, other browsers and advanced response-loss recovery remain unverified. STUN-only connectivity retains the starter's strict-network limitation.

## Phase 2: Make it good

- **Direction:** a hopeful solarpunk palette, Fraunces headings and DM Sans interface text make an anonymous app feel welcoming. Shared tokens and inline Tailwind utilities keep iteration consistent.
- **Continuity:** one globe stays mounted through welcome, discovery and conversations. Short slide transitions carry the welcome, discovery, connection and chat cards between phases, with reduced-motion preferences honored. When chat opens on desktop, the globe shifts to center in the remaining space while staying interactive. Floating chat/video panels preserve map context and unsent drafts, adapting to desktop and mobile.
- **Clarity:** distinct permission/join feedback, retry actions, loading/empty/stale states and disabled busy dots make availability explicit. Privacy copy distinguishes peer-to-peer content from transient server coordination.
- **Accessibility:** system/light/dark appearance, visible focus, reduced motion, 44 px controls and native consent dialogs support keyboard use. Mobile layouts were inspected separately; physical-device keyboard behavior still needs verification.

## Phase 3: Make it secure

- **Session ownership — high:** API regressions reproduced impersonation using shared dot IDs. [Private session tokens](lib/session.ts), stored as hashes server-side and held in page memory, now authorize polling, signaling and departure.
- **Connection consent — high:** authenticated participants could reserve or interrupt unrelated connections. [Server rules](lib/coordination.ts) require the intended recipient's consent and matching peer/attempt, with atomic transitions and pending-request expiry.
- **Media cancellation — high:** delayed capture could leave camera/microphone tracks live after cancellation. Pending capture is invalidated, late tracks are stopped and obsolete callbacks cannot reopen video.
- **Remaining:** medium-priority work includes bounded request bodies, abuse/storage budgets, independent retention, peer-input limits and geographic privacy-offset boundaries. Deployed headers and database TLS configuration also need verification. The [security report](docs/security_best_practices_report.md) records evidence and triage.
