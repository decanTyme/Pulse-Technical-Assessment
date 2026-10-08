# Assessment notes

[Live app](https://pulse-technical-assessment-red.vercel.app/) · [Repository](https://github.com/decanTyme/Pulse-Technical-Assessment)

I used Codex for investigation, research, implementation and tests, while reviewing decisions, requesting explanations and narrowing proposals that exceeded the assessment's scope. I prioritized core journeys and the highest-impact security fixes before redesign.

## Phase 1: Make it run

- **Onboarding:** the documented setup produced `Cannot find module '.prisma/client/default'` and a missing `PrismaClient` export. Prisma 7 no longer generates the client during `db push`; explicitly running `npx prisma generate` resolved this README gap.
- **Presence:** two-participant testing exposed abandoned dots kept alive by another participant's polling. [Polling](app/api/poll/route.ts) now refreshes only the requesting session's `lastSeen`.
- **Chat and reconnect:** browser journeys exposed mismatched chat message types, premature ICE handling and cleanup races. [WebRTC](lib/webrtc.ts) now uses consistent message types and queues candidates until a remote description exists. [Connection handling](app/page.tsx) orders writes and completes cleanup before retrying; departure ends the surviving chat.
- **Coordination:** unsuccessful HTTP responses now fail explicitly, client waits are bounded, and direct Zod schemas reject malformed requests. Neon and Vercel functions use Singapore: close to local development and colocated for database-heavy polling.
- **Verification:** requirements-based Playwright journeys established the failing baseline using real routes, an isolated PostgreSQL database and native WebRTC. Focused TypeScript tests use Node's runner. Automated coverage is scoped to Chromium; physical-device/network behavior and advanced response-loss recovery remain unverified. STUN-only connectivity retains the starter's strict-network limitation.

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

## Phase 4: Make it better

- **Built:** optional 60-character conversation starters above participants' dots, including their own. Text is trimmed, validated and rendered as text; storage stays with the current presence record and uses existing polling.
- **Why:** an anonymous dot gives little reason to approach someone. A short starter offers a topic while keeping entry optional and low effort.
- **Verification:** **16 focused Node checks and 10 Chromium checks passed** against a fresh local production build, with browser retries disabled. Coverage includes starter visibility, entry recovery, ownership, chat, reconnect and departure. TypeScript and lint also passed.
- **Planning lesson:** I underestimated baseline effort and allowed debugging and test scope to expand, leaving less time for design and product differentiation. Next time, I would set firmer baseline exit criteria, timebox agent investigations and reserve explicit time for design, the feature and deployment.
- **With more time:** finish input/abuse and retention controls, verify mobile hardware and other browsers, and add basic SEO. Further polish the UI/UX and refine animations while respecting reduced-motion preferences. Extend starters with editable, reportable notes such as “Listening to…”. Build **Shared Horizon**: a voluntary two-person conversation ritual where each privately chooses something to share, then both choices are revealed together in a small, beautifully presented moment once both respond.
