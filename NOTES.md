# Assessment notes

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
- Local startup does not complete Phase 1; the browser suite keeps failing connection journeys visible.

### Development tooling

- Configured Prettier with two-space indentation and no semicolons for consistent formatting.

### Functional fixes

- Polling now refreshes only the caller's heartbeat. Previously, one active participant kept abandoned dots alive by refreshing every session.

### Focused regression testing

- Added `npm run test:unit` using Node's built-in runner, with no additional testing dependency. Tests and helpers use `.mts` TypeScript modules, run directly on Node 24.12+, and are checked by the existing strict TypeScript project. The existing compiler transforms application TS/TSX for the harness. The **heartbeat regression passes**. Tests execute the polling handler with an in-memory database boundary and verify caller-only heartbeats and stale expiry. These checks do not prove real database transactions, native ICE, React scheduling, or media transport. See [test scope](tests/unit/README.md).

### Automated browser testing

- Added Playwright 1.63.0 with one configuration and Chromium/Firefox projects. `npm run test:e2e` runs 18 scenarios per browser (36 checks) against a production build, grouped into entry, presence/map, connections/chat, and video specs. It reads the isolated test database's `DATABASE_URL` only from ignored `.env.test.local`; Zod 4 validates the URL, and a guard rejects the known development database.
- All six entry checks pass locally. Firefox's test launch temporarily disables its content sandbox on Windows to work around a page-creation hang in the restricted runner. This assessment workaround weakens browser isolation and should be removed for normal test environments; see [test setup and limitations](tests/e2e/README.md).
- The browser baseline before these functional fixes produced **16 passes and 20 failures** across all 36 checks. Eighteen failures stopped at the connection-readiness prerequisite, leaving their later assertions unverified; two reproduced stale-dot persistence. Phase 1 remains incomplete. Failures stay active as regression checks, and per-session cleanup left the test database empty.
- Derived six critical user journeys from [the business requirements](docs/requirements.md): enter/explore, request consent, exchange messages, video, end/reconnect, and leave/start fresh. Added checks for ignored requests, a third participant requesting a busy peer, new session IDs/privacy offsets, map gestures, video decline, media-permission failures, and closing a connected tab. Video scenarios exercise either initiator and the other participant ending the call. See [coverage and boundaries](tests/e2e/README.md).
- The two-participant scenarios use real API routes, Prisma/PostgreSQL, and WebRTC, with synthetic locations and media devices. Entry errors are injected to verify the UI response. Mapbox's SDK uses a local blank style, so real tiles/token validity, native permission dialogs, hardware permissions, cross-network connectivity, and deployment remain separate checks.
- Tests build production code in the normal `.next` directory and start a fresh server at `http://localhost:3000`; stop the development server before running them. One worker, explicit per-session cleanup, no automatic retries, and ignored artifacts keep failures reproducible. See [test setup and debugging](tests/e2e/README.md).

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
