# Focused regression tests

These tests check route and peer-session behavior with controlled dependencies.
They run without a live database, browser, or live credentials.

## Run

Use Node 24.12 or newer. From the repository root:

```sh
npm test
npx tsc --noEmit
```

Node's built-in runner executes the `.mts` tests directly. The extension selects
ES modules without changing the application's package module type. Node strips
types but does not check them; the second command checks application and test
types with the existing strict configuration.

## Coverage

| Tests                                          | Behavior                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [request.test.mts](request.test.mts)           | JSON parsing with native Requests, including malformed, empty, and consumed bodies.                                   |
| [join.test.mts](join.test.mts)                 | Coordinate validation, fresh private credentials, and persistence of offset coordinates.                              |
| [ownership.test.mts](ownership.test.mts)       | Unauthorized mailbox/signaling/departure denial, owner access, credential projection, and legacy rejection.           |
| [presence.test.mts](presence.test.mts)         | Caller-only heartbeat refresh and abandoned-session cleanup.                                                          |
| [signaling.test.mts](signaling.test.mts)       | Zod validation, reservation rollback, accept/end cleanup, and protection of unrelated active reservations.            |
| [api.test.mts](api.test.mts)                   | Credential transport, failed-entry recovery, HTTP failures, successful-write completion, and bounded signaling waits. |
| [peer-session.test.mts](peer-session.test.mts) | Chat delivery/send failure, incoming description/ICE ordering, closure, and hangup acknowledgement/timeouts.          |

## Boundaries and limitations

[The source helper](../helpers/source.mts) uses the existing TypeScript compiler
to load application modules in a VM with controlled dependencies. Native Node
type stripping does not handle JSX or Next.js path aliases. Relative test imports
include their `.mts`/`.ts` extensions, permitted by the existing no-emit
TypeScript configuration.

Route tests use a database fake, real Zod, and Node's actual cryptographic
functions for ownership checks. Join tests substitute a
deterministic privacy offset to verify that the route persists the returned
coordinates rather than raw input; geometry is covered in
[the browser suite](../e2e/README.md).

[The WebRTC fake](../helpers/webrtc.mts) models asynchronous description
installation and channel events, enforcing the remote-description prerequisite
for ICE candidates. Tests assert message delivery, candidate processing, and
closure outcomes. Controlled timers cover signaling and hangup limits without
real waiting.

These checks do not establish real Prisma/PostgreSQL transaction behavior,
React scheduling, native ICE, or media transport. The browser suite exercises
core journeys with the real API, database, and peer connections.

Reference: [Node's native TypeScript support](https://nodejs.org/download/release/v24.15.0/docs/api/typescript.html).
