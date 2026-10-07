# Focused regression tests

Use Node 24.12 or newer and run `npm test` from the repository root.
Node's built-in test runner executes the `.mts` TypeScript tests and helpers
directly, without an additional runner dependency. `.mts` explicitly selects
ES modules without changing the application's package module type.

Node strips types at runtime; it does not check them. Run `npx tsc --noEmit` to
check the application and all tests with the existing strict configuration.
Relative imports include their `.mts`/`.ts` extensions; `allowImportingTsExtensions`
permits those imports in the existing no-emit project.

The source helper still uses the existing TypeScript compiler to transform
application TS/TSX and supplies controlled dependency fakes in a VM. Native
Node type stripping does not process JSX or resolve Next.js path aliases.

Tests execute join, polling, and signaling handlers with controlled database boundaries, including request validation, reservation rollback, and cleanup. Join and signal tests use the real Zod implementation. Join tests replace the privacy-offset function to verify that its returned coordinates are used in both upsert branches; they do not test the offset geometry. JSON-reading tests exercise native Requests with valid, malformed, empty, and consumed bodies.

Peer-session tests relay a sent message into another session's real receive handler and verify that unavailable or closed channels report a failed send. Incoming signaling checks cover ICE arriving before its offer, an offer and ICE arriving in one batch, skipping queued work after close, and continuing after a rejected signal. The WebRTC helper models asynchronous description installation and rejects candidates without a remote description; it does not establish a native peer connection.

Small fakes replace database/network/browser boundaries. These checks do not
prove real Prisma/Postgres transactions, native browser ICE, React scheduling,
or media transport. The Playwright suite covers the real API/database/browser journeys.

Reference: [Node's native TypeScript support](https://nodejs.org/download/release/v24.15.0/docs/api/typescript.html).
