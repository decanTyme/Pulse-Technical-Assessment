# Playwright setup

Install dependencies with `npm ci`, then install the pinned Playwright browsers:

```sh
npx playwright install chromium firefox
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

## Runner configuration

The runner targets Chromium and Firefox with one worker and no retries. It builds
production code in the normal `.next` directory and starts a fresh server at
`http://localhost:3000`. Stop the development server first; an occupied port fails
instead of reusing another build.

This tooling change includes no test scenarios. Once specs are added under
`tests/e2e`, run them with `npm run test:e2e` or `npm run test:e2e:ui`.
The configured Mapbox placeholder requires browser fixtures to intercept map
downloads; it cannot authenticate real Mapbox requests.

On Windows, the Firefox project temporarily sets `MOZ_DISABLE_CONTENT_SANDBOX=1`
only for its disposable browser process. It avoids a page-creation hang observed
in the restricted runner but weakens content-process isolation. Remove it for
normal test environments. No matching upstream issue was found; the config links
[Mozilla's debugging override](https://firefox-source-docs.mozilla.org/contributing/debugging/debugging_on_windows.html#console-debugging).

## Artifacts

Failure screenshots, traces, and HTML reports remain local and are ignored by
Git. Traces can contain SDP and network information; keep them private. The
config retains traces on the first failing attempt, and Playwright's native
`--trace` option can override this locally. Inspect reports with
`npx playwright show-report`.

References: [Next.js Playwright guide](https://nextjs.org/docs/app/guides/testing/playwright),
[Playwright installation](https://playwright.dev/docs/intro#installation),
[managed web server](https://playwright.dev/docs/test-webserver).
