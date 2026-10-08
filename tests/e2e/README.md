# Browser tests

Playwright exercises Pulse's critical user journeys against a fresh production
build, real API routes, Prisma/PostgreSQL, and native browser WebRTC.
Automated coverage is limited to Chromium.

## Setup

Install dependencies with `npm ci`, then install the pinned Chromium build:

```sh
npx playwright install chromium
```

Use an isolated **schema-only Neon branch**, or an otherwise empty PostgreSQL
test database with this project's schema. Presence queries include every session,
so the test database must be separate from development and shared environments.
Configure its pooled runtime connection in ignored `.env.test.local`:

```dotenv
DATABASE_URL="postgresql://TEST_ROLE:TEST_PASSWORD@TEST_HOST/TEST_DATABASE?sslmode=require"
```

A schema-only branch inherits the schema at creation. Keep the test database
synchronized when the Prisma schema changes. For an empty database, apply the
existing migrations with `npx prisma migrate deploy`, supplying that test
database's direct connection as `DATABASE_URL` in the shell.

[config.ts](config.ts) validates the URL with Zod and rejects the known
development database, including its direct/pooled endpoint variants. It cannot
identify every external alias. The runner reads its database URL only from
`.env.test.local` and passes it explicitly to the production build/server;
there is no fallback to the development URL.

## Run

Stop the development server first: tests use the normal `.next` directory and
`http://localhost:3000`.

```sh
npm run test:e2e
npm run test:e2e -- --headed
```

The runner builds and starts a fresh server rather than reusing an existing one.
An occupied port fails the run. One worker keeps shared presence counts
predictable. One retry is allowed, but a test that passes only on retry still
fails the run through `failOnFlakyTests`.

The [fixture](fixtures.ts) creates isolated browser contexts for anonymous
participants and captures their issued session credentials. At teardown it
closes the contexts and removes only those sessions through the authenticated
leave API. A session already removed by
its departure beacon returns 401 on repeated cleanup. There is no blanket
database reset.

## Coverage

Specs follow user behavior on Pulse's single page, derived from
[the business requirements](../../docs/requirements.md).

| Spec                                       | Journeys                                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| [entry.spec.ts](entry.spec.ts)             | Entry screen, denied location, location timeout, and failed-entry retry.                                                              |
| [presence.spec.ts](presence.spec.ts)       | Live dots, clean departure, missed-heartbeat expiry, new sessions/privacy offsets, zoom, and pan.                                     |
| [connections.spec.ts](connections.spec.ts) | Consent, decline/ignored-request retry, messages in both directions, busy-peer exclusion, End/reconnect, and connected-tab departure. |
| [video.spec.ts](video.spec.ts)             | Either participant initiates; remote frames/audio, return to chat, decline, and media-permission failure on either side.              |
| [ownership.spec.ts](ownership.spec.ts)     | Real API/database checks: fresh IDs, denied impersonation/deletion/mailbox access, and preserved owner signaling.                     |

Chat assertions require delivery to the recipient. Video assertions require
remote media reception and usable chat after ending video.

## Fixtures and limits

Participants use synthetic locations and fake camera/microphone devices.
Location errors and media denial are injected at browser API boundaries.
The entry-retry scenario intercepts only the first join with HTTP 503, before
any server write; its retry uses the real join API and test database.
The ignored-request scenario advances only the initiator's browser clock;
server expiry uses real time.

Privacy checks measure broadcast coordinates with an independent great-circle
calculation, allowing 10 m tolerance for the starter's approximate offset
conversion. They do not audit database rows or logs for raw locations/messages.

Mapbox's SDK and markers run with intercepted downloads and a blank style.
The placeholder token is sufficient for those intercepted requests; real map
styling and token validity are outside this suite.

Native permission dialogs, physical devices, other browser engines, cross-network
connectivity, and deployed behavior require separate verification. The starter's
STUN-only connectivity limit applies on restrictive networks. Test results and
open functionality issues are recorded in [assessment notes](../../NOTES.md).

## Debugging and artifacts

```sh
npm run test:e2e:ui
npm run test:e2e -- connections.spec.ts --debug
npm run test:e2e -- --trace retain-on-failure
npx playwright show-report
```

Failure screenshots, traces, and the HTML report are local and ignored by Git.
The configuration retains a trace on the first failing attempt; Playwright's
`--trace` option overrides this for a run. Traces can contain session credentials,
SDP and network information, so review them before sharing. The multi-participant contexts are
closed explicitly by the fixture; headed/debug mode helps inspect their flow.

References: [Next.js Playwright guide](https://nextjs.org/docs/app/guides/testing/playwright),
[Playwright isolation](https://playwright.dev/docs/browser-contexts),
[managed server](https://playwright.dev/docs/test-webserver).
