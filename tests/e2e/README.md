# Browser tests

Install dependencies with `npm ci`, then install the pinned Playwright browsers:

```sh
npx playwright install chromium
```

## Test database

Create an isolated **schema-only Neon branch** (or an empty PostgreSQL test
database with this project's schema). Keep it separate from the database used by
`npm run dev`: presence queries operate on every session in the database.
Configure its pooled runtime connection in ignored `.env.test.local`:

```dotenv
DATABASE_URL="postgresql://TEST_ROLE:TEST_PASSWORD@TEST_HOST/TEST_DATABASE?sslmode=require"
```

The Neon branch inherits the schema, so no schema push is needed. The runner
rejects a URL identifying the known development database, even when switching
between its direct and pooled endpoint; this check cannot detect every alias.
For an empty database, apply the existing Prisma migrations using its direct
connection and
`npx prisma migrate deploy`; supply that connection as `DATABASE_URL` in the shell
for that command. Never run schema/cleanup commands against a shared database.

The runner reads `DATABASE_URL` only from `.env.test.local` and validates it
with Zod 4. It never falls back to the normal environment's `DATABASE_URL` or
`.env`. The URL is explicitly passed to the production build/server, since
production mode doesn't automatically load `.env.test.local`.

## Run and coverage

```sh
npm run test:e2e
npm run test:e2e -- --project=chromium --headed
```

One configuration runs 18 scenarios in Chromium. Automated browser coverage
is scoped to Chromium for this assessment; other engines are deferred.
Additional coordination failure/race scenarios are deferred while validating
the core business journeys.
The entry scenarios cover the initial screen, denied location, and location
timeout. Browser errors are injected to avoid native permission-dialog timing.
They exercise the complete page in a browser, even though these paths never
call the database. They share the same server setup as the other scenarios.

The participant scenarios run real Next.js route handlers,
Prisma/PostgreSQL signaling, and browser WebRTC. Two clean browser contexts
represent independent anonymous participants. The suite checks presence/departure, decline/retry,
bidirectional chat delivery, hang-up/reconnect, video reception and return to chat,
and expiry when a participant stops polling. Tests use synthetic city coordinates
and fake camera/microphone devices; they don't access personal devices/profiles.
The busy-peer scenario adds a third isolated participant.

The critical user journeys come from [the business requirements](../../docs/requirements.md):

| Journey               | Browser assertions                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter and explore     | Anonymous entry, location errors, live dots, zoom/pan, a broadcast offset of 1–3 km, and a fresh offset/session ID on re-entry.                                                                            |
| Request a connection  | Consent before chat, decline/retry, ignored-request notification and retry, and rejection of a third participant while connected.                                                                          |
| Exchange messages     | Actual delivery in both directions, rather than the sender's local echo.                                                                                                                                   |
| Start and end video   | Either participant initiates; the other accepts and ends it; both receive frames/audio and return to working chat. Unaccepted requests do not acquire media; decline and media-denial paths preserve chat. |
| End and reconnect     | Both chat panels close on End, with appropriate remote feedback and a subsequent connection. Closing a connected tab also ends the remaining participant's chat.                                           |
| Leave and start fresh | Clean departure removes the dot before stale expiry; missed heartbeats remove it while another participant keeps polling; re-entry leaves no old dot.                                                      |

Specs are grouped by user behavior on Pulse's single page:

| Spec                                       | Coverage                                                                                                  | Scenarios per browser |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------- |
| [entry.spec.ts](entry.spec.ts)             | Entry screen and location-error recovery.                                                                 | 3                     |
| [presence.spec.ts](presence.spec.ts)       | Live dots, departure/expiry, privacy offsets/re-entry, and map gestures.                                  | 4                     |
| [connections.spec.ts](connections.spec.ts) | Consent, decline/timeout/retry, chat, busy peers, hang-up/reconnect, and tab closure.                     | 6                     |
| [video.spec.ts](video.spec.ts)             | Either initiator, remote media reception, return to chat, decline, and permission failure on either side. | 5                     |

Spec names describe behavior rather than mirroring individual application files.
The ignored-request case advances only the
initiator's browser clock through the existing 30-second timeout. Server expiry
uses real time. Media denial is injected at `getUserMedia`; route handlers,
signaling, and peer connections remain real. Privacy-offset checks use an
independent great-circle calculation with 10 m tolerance for the starter's
approximate conversion; they observe coordinates broadcast to peers, rather
than verifying the local marker's coordinates.

These browser assertions do not prove that every transient database row is
deleted or that raw coordinates/messages never reach storage or logs. Those
privacy requirements also need a separate API/database and code review.

The latest full run passed all **18 Chromium scenarios on their first attempts**
against a fresh production build. This covers the real API/database, native chat
and video transport, and the core journeys listed above.

That run also included Firefox: its nine connection-dependent scenarios failed
at initial chat readiness, including on retry. Firefox coverage is now deferred
to keep the assessment focused on the Chromium baseline and release checks.
Cross-browser compatibility is not established. This result predates removal
of the Firefox project; the application and Chromium scenarios are unchanged.

Mapbox's actual SDK and markers run against an intercepted blank style. The
runner supplies a placeholder token because those requests are fulfilled by the
fixture instead of Mapbox. This removes tile-service/token dependencies, so real map styling, token validity,
cross-network NAT traversal, TURN, hardware permissions, and deployed behavior
still need manual checks. Chat and media use the real peer connection.

Stop the development server before running tests. The runner builds production
code in the normal `.next` directory and launches a fresh server at `http://localhost:3000`.
An occupied test port fails instead of silently reusing another checkout/build.
One worker keeps the shared presence store predictable. The configuration
allows one retry, but `failOnFlakyTests` still fails the run when a test passes
only on retry. Each test removes only its own session IDs after closing its contexts;
there is no blanket database reset. Use an otherwise empty test branch.

Known broken behavior should fail its assertion. Keep fixes in separate commits;
don't replace failing assertions with skips or expected failures just to turn the
report green. A chat test checks the recipient's message, not the sender's echo.

## Debugging and artifacts

```sh
npm run test:e2e:ui
npm run test:e2e -- connections.spec.ts --debug --project=chromium
npm run test:e2e -- --trace retain-on-failure
npx playwright show-report
```

Failure screenshots and the HTML report remain local and are ignored by Git.
The config retains traces on the first failing attempt. Playwright's native
`--trace` option can override this for a local run. Traces can contain SDP and network information; keep
them private and don't publish them unreviewed or upload them to public CI
artifacts. The custom multi-participant contexts are closed explicitly by the
fixture; use headed/debug mode to inspect their flow.

No CI workflow is included yet: the suite needs an isolated test database
and reviewed artifact handling before automated remote runs.

References: [Next.js Playwright guide](https://nextjs.org/docs/app/guides/testing/playwright),
[Next.js testing scopes](https://nextjs.org/docs/app/guides/testing),
[Playwright best practices](https://playwright.dev/docs/best-practices),
[Playwright browser isolation](https://playwright.dev/docs/browser-contexts),
[retrying assertions](https://playwright.dev/docs/test-assertions),
[managed web server](https://playwright.dev/docs/test-webserver),
[browser clock control](https://playwright.dev/docs/clock),
[browser API emulation](https://playwright.dev/docs/mock-browser-apis).
