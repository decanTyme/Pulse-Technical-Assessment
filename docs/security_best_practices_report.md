# Security review

The initial review was conducted on 2026-10-08 against commit `b7c7fb6`. Session ownership (001) and connection consent (002) are implemented and verified. Findings 003–010 remain open, with baseline and hardening priorities listed below. Original findings are retained alongside their resolutions and verification results.

The review identified session ownership, connection authorization, and camera/microphone cancellation as the highest-impact risks. Private credentials authorize session operations, while server-owned connection state enforces recipient consent and pair membership. The remaining baseline priorities are media cancellation, bounded API inputs and abuse controls, and accurate privacy wording.

## Scope and evidence

- Application review covered all four API routes, request parsing, Prisma queries/schema, WebRTC/media lifecycle, browser rendering, privacy wording, and repository configuration.
- Initial behavioral probes executed the route and peer-session code with synthetic requests, an in-memory database double, and controlled media/RTC doubles. These probes reproduced the findings described below. They did not exercise a live database, physical media devices, or a public deployment, and do not establish native device behavior or PostgreSQL concurrency behavior.
- `npm audit --json --ignore-scripts` completed with **zero reported vulnerabilities** across the current dependency tree. This is a known-advisory check, not a security guarantee.
- A targeted scan of 142 historical text blobs reachable through local Git refs found no matches for the selected private-key, secret-token, or non-placeholder database-password patterns. Environment/private-context files are excluded; only `.env.example` appears in the tracked environment-file history. This was not an exhaustive secret-detector scan.
- Verification of the ownership and consent fixes included the focused Node suite, real API/PostgreSQL checks, Chromium journeys, production build, and TypeScript check. Consent verification includes selected concurrent admission scenarios. Public deployment, physical-device behavior, and broader concurrency/load behavior remain outside that verification.

## Triage

Severity reflects impact at discovery. The baseline column identifies controls required for deployment readiness; the hardening column records subsequent work.

| ID  | Severity | Finding                                                     | Deploy-ready baseline                                       | Later hardening                                      |
| --- | -------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| 001 | High     | Public IDs authorized private session operations            | Completed: per-session ownership checks                     | Review expiration/replay behavior                    |
| 002 | High     | Signals can change unrelated connections without consent    | Completed: recipient consent, pair checks, atomic admission | Broaden concurrency and delayed-write testing        |
| 003 | High     | Late media acquisition survives stop/disconnect             | Cancel acquisition logically and stop late tracks           | Native-device timing checks                          |
| 004 | Medium   | Request and signaling validation is incomplete              | Bound bodies/IDs and validate payloads by signal type       | Extend malformed-input coverage as needed            |
| 005 | Medium   | Coordination work and storage lack application abuse limits | Set and verify practical request/queue budgets              | Adaptive controls and broader load testing           |
| 006 | Medium   | Privacy copy overpromises storage and deletion behavior     | Correct the copy and disclose coordination/network metadata | Bound physical retention independently of visitors   |
| 007 | Medium   | Peer messages and client collections are unbounded          | Keep accepted-peer trust assumptions explicit               | Cap messages, history, candidates, and control input |
| 008 | Medium   | Polar inputs can defeat the privacy offset                  | Record the geographic limitation                            | Use a geodesic offset with boundary checks           |
| 009 | Low      | Security-header policy is not configured in the app         | Verify deployed headers/configuration                       | Add compatible CSP/framing/cache policies            |
| 010 | Low      | Database TLS mode relies on changing alias behavior         | Verify production certificate validation                    | Make `verify-full` explicit before driver upgrades   |

## High severity

### 001: Public session IDs authorized private operations — resolved

**Rule:** `NEXT-AUTH-001` / object-level authorization. **Evidence:** original behavior reproduced with a database double; resolution verified against the real API/PostgreSQL stack.

**Original behavior:** polling used the query-string ID to select and drain a mailbox, while also returning other participants' public IDs. Leave deleted records using the submitted ID, join upserted that ID, and signaling trusted the submitted `fromId`.

**Impact:** knowledge of a public dot ID allowed session impersonation, mailbox consumption, and presence deletion. The initial probes reproduced unauthorized mailbox consumption and deletion; interception of actual chat/video was not attempted.

**Resolution:** [join](../app/api/join/route.ts#L43) creates a server-issued public UUID and an independent 256-bit random token. Supplied IDs cannot reclaim or overwrite an existing presence. [Ownership verification](../lib/session.ts#L31) checks the token against its stored SHA-256 hash using constant-time comparison before [polling](../app/api/poll/route.ts#L26), [signaling](../app/api/signal/route.ts#L62), or [departure](../app/api/leave/route.ts#L32) accesses that session's data. This applies [OWASP's object-authorization guidance](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/) to anonymous sessions.

The client keeps the token in page memory and sends it in authorization headers or the departure beacon body. Credentials are excluded from public peer responses, URLs, logs, and persistent browser storage. Join and mailbox responses use `Cache-Control: no-store`. The additive schema change preserves existing rows; legacy sessions with null hashes cannot authenticate and must re-enter.

**Verification:** unauthorized polling returns HTTP 401 without changing presence or the mailbox. A real API/PostgreSQL regression rejects another participant's token for polling, spoofed signaling, and departure, then confirms that the queued signal remains available to its owner and peer responses expose only public fields. The recorded run passed all **36 Node checks** and **19 Chromium checks**, with every Chromium check passing on its first attempt. The production build and TypeScript check succeeded. Development and test database comparisons identified only the nullable hash-column addition, applied without resets or data-loss flags.

**Remaining considerations:** HTTPS protects credential transport outside local development. Possession of the token permits acting as that session while its presence record exists; deleting presence removes the verifier. Connection and pair authorization is covered under 002. Deployment readiness depends on the remaining baseline controls and configuration checks.

### 002: Connection consent and reservation ownership were not enforced by the server — resolved

**Rule:** `NEXT-AUTH-001` / connection authorization. **Evidence:** original sequential behavior reproduced with a database double; resolution verified through real API/PostgreSQL requests, including selected concurrent admissions.

**Original behavior:** signaling checked the target's existence/busy flag only for `request`. The `accept`/`end` branch updated both submitted IDs and saved the signal in a transaction, without checking a pending request, current partner, or connection attempt.

**Impact:** an `accept` without a preceding request reserves both participants. A registered third participant's `end` clears another participant's busy flag even when that participant belongs to a different conversation. Both were reproduced. Making those writes atomic does not authorize them.

**Resolution:** [connection coordination](../lib/coordination.ts#L139) records the current attempt, peer, initiator, and request time on both presence rows. Only the recipient can accept or decline the matching pending request; SDP/ICE requires the accepted pair. Requests reserve one pending interaction per participant for at most 30 seconds. The attempt UUID identifies signals and is not an ownership credential; the separate private token still authenticates the sender.

Pair transitions and mailbox writes share a serializable transaction. [Bounded retry](../lib/coordination.ts#L28) applies only to Prisma's `P2034` rollback error, not transport failures with an uncertain commit outcome. This follows [Prisma's transaction guidance](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions#transaction-timing-issues). Ending, departure, and stale cleanup release only the matching pair/attempt. Obsolete or unrelated `end` calls succeed without changing another connection; other invalid transitions return 409. Pending expiry notifies both participants, and the browser filters controls by peer and attempt.

**Verification:** the unsolicited-acceptance regression failed before the fix and passed afterward. All **41 Node checks** passed; all **22 Chromium checks** passed on their first attempts against the production build, including 19 browser journeys and three real API/PostgreSQL checks. The [consent spec](../tests/e2e/consent.spec.ts) verifies that competing requests produce one pending pair, duplicate acceptances produce one acceptance, and third-participant or obsolete controls cannot change the current pair. Existing chat, video, End/reconnect, ignored-request retry, and connected-tab departure remain green. TypeScript and scoped source lint passed. Development and isolated test schemas received only five nullable columns and two indexes, without resets or data-loss flags.

**Remaining considerations:** these concurrency cases do not prove every interleaving or load behavior. Existing participants must re-enter; legacy signals without an attempt ID are drained without delivery. Matching `end` handling also covers a waiting requester, but the separately deferred lost-acceptance-response scenario has not been rerun. Broader delayed-response and cleanup recovery remains verification work.

### 003: Camera/microphone acquisition can complete after consent has been withdrawn

**Rule:** application media-consent/lifecycle boundary. **Evidence:** confirmed with synthetic media and RTC doubles.

[`startVideo`](../lib/webrtc.ts#L199) assigns the result of `getUserMedia` and attaches its tracks after the await. [`stopVideo`](../lib/webrtc.ts#L212) stops only an already-assigned stream; [`close`](../lib/webrtc.ts#L259) does not invalidate pending acquisition. The [page callbacks](../app/page.tsx#L214) can also set video active after an old acquisition completes.

**Impact:** stopping video while acquisition is pending can still attach the returned tracks to the live peer. Closing the peer first causes track attachment to fail, but the acquired tracks remain unstopped. The probes establish those lifecycle errors; no camera or microphone was opened during the review.

**Baseline requirement:** stopping or closing must invalidate pending media acquisition and stop any tracks returned for a cancelled attempt. Each attempt should share one pending acquisition, with success and failure callbacks guarded against a changed peer or video attempt. Delayed-acquisition regression tests should verify these lifecycle boundaries.

## Medium severity

### 004: Validation happens after unrestricted body parsing and does not validate signaling structure

**Rule:** `NEXT-INPUT-001` / `NEXT-DOS-001`. **Evidence:** confirmed route behavior; hosting-layer limits were not exercised.

The [JSON reader](../lib/request.ts#L8) fully parses the body before validation. [Signal ID schemas](../app/api/signal/route.ts#L15) accept any string. The original join route used a separate bounded ID rule; the ownership fix instead generates IDs on the server. Polling, signaling, and departure still lack a shared bounded ID schema. The payload's 64 KiB limit counts UTF-16 code units after parsing, without bounding the complete request in bytes or validating the enclosed SDP/ICE JSON.

**Impact:** the initial probes stored empty IDs and malformed signaling payloads. A body over 512 KiB containing an ignored extra field was also parsed and accepted by the handler. Ownership checks restrict the acting ID, but recipient IDs, payload structure, and total body size still require validation. Large or invalid input can waste parser, database, and browser work; no resource-exhaustion attack was run.

**Baseline requirement:** request parsing needs a small byte limit, consistent bounded ID validation, and signal-specific payload schemas. The consent fix rejects self-targeting, validates the attempt UUID, and enforces pair/state checks; actor and recipient ID bounds and SDP/ICE structure remain incomplete. Limits must support the `sendBeacon` text-body path and cover unknown fields even when the schema strips them.

### 005: Coordination endpoints expose unbounded work and storage

**Rule:** `NEXT-DOS-001`. **Evidence:** static application finding; deployed edge controls are unknown.

Join can create arbitrarily many sessions; signal writes have no per-actor or queue budget. [Polling](../app/api/poll/route.ts#L41) performs global cleanup and unbounded peer/mailbox reads. Individual database timeouts do not limit the number of calls or rows.

**Impact:** repeated requests can consume database, function, and client resources. A per-payload size cap alone cannot bound aggregate traffic or queue growth. This is the resource-control boundary described by [OWASP API4](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/).

**Baseline requirement:** join, signaling, and polling need practical request budgets, bounded signal queues, and bounded poll batches that accommodate normal polling and ICE bursts. Enforcement must cover multiple serverless instances through shared database or deployment-edge controls. Existing hosting controls need inspection before additional infrastructure is selected. Broader load testing belongs to hardening after the initial budgets are established.

### 006: Privacy wording promises more than the implementation guarantees

**Rule:** application privacy/retention requirements. **Evidence:** static data flow and cleanup review; infrastructure retention was not inspected.

[EntryGate](../app/components/EntryGate.tsx#L59) says nothing is stored and closing the tab ends everything. The [schema](../prisma/schema.prisma#L14) stores offset coordinates and signaling payloads. Cleanup runs on leave or poll; stale-time constants are eligibility thresholds, not an independent deletion timer. When all visitors stop polling and departure is lost, rows remain until another cleanup call. Raw location also reaches join before offsetting; chat/video content has no server-side storage path in the reviewed code. WebRTC signaling may contain network addresses, as described in the [W3C security/privacy considerations](https://www.w3.org/TR/webrtc/#security-and-privacy-considerations).

**Baseline requirement:** privacy wording must distinguish peer-to-peer chat/video from transient server coordination, disclose location-offset and peer-network limitations, and describe departure as best-effort cleanup with stale-session removal. **Hardening:** physical cleanup needs a bounded schedule independent of visitors, supported by verification of provider, log, and backup retention. External cleanup could alter the retention assessment; none is configured in this repository.

### 007: A connected peer can supply unbounded data to the browser

**Rule:** runtime input/resource bounds at the peer boundary. **Evidence:** static finding; no browser stress test was performed.

The [data-channel handler](../lib/webrtc.ts#L98) accepts chat strings without length/rate limits and casts control strings to `PeerControl`. [Message history](../app/page.tsx#L141) and [pending ICE candidates](../lib/webrtc.ts#L136) grow without explicit bounds.

**Impact:** a malicious accepted peer can grow client memory and rendering work. React escapes message text; this finding is resource abuse, not a demonstrated XSS issue.

**Hardening:** incoming envelopes and controls need validation; chat length, history, candidate queues, and message rates need bounds. This work becomes a baseline priority if hostile-peer resilience is included in the acceptance criteria.

### 008: Privacy offsetting fails at geographic boundaries

**Rule:** the required 1-3 km offset. **Evidence:** reproduced with synthetic coordinates and controlled randomness.

The [offset function](../lib/geo.ts#L15) approximates degree distances and clamps latitude. Valid input at the north pole with a northward bearing returns the original physical point: the demonstrated distance is zero rather than 1-3 km.

**Hardening:** a geodesic destination calculation should preserve the required offset near poles and the date line, with independent distance checks at those boundaries. Existing ordinary-location browser checks do not cover these cases. Geographic correction is independent of API ownership and consent.

## Low severity / configuration verification

### 009: App-level security headers are not configured

**Rule:** `NEXT-HEADERS-001` / `NEXT-CSP-001`. **Evidence:** configuration observation; deployed response headers were not checked.

[`next.config.ts`](../next.config.ts#L5) configures a development origin but no general security-header policy. At the initial review, mailbox responses lacked explicit server-side `Cache-Control: no-store`; the ownership fix adds it to join and polling responses. CSP and framing policies remain unconfigured in the application. Deployed headers were not inspected, and no cache leak was demonstrated.

**Baseline verification:** production headers and edge settings require inspection. **Hardening:** header policy should cover framing, content types, referrers, permissions, and sensitive-response caching, with a CSP compatible with Next and [Mapbox's worker requirements](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/). Chat uses escaped React text, and the map's `innerHTML` assignment contains a fixed application-authored string; the absence of CSP does not establish XSS.

### 010: TLS verification depends on a deprecated SSL-mode alias

**Rule:** database transport configuration. **Evidence:** installed parser/configuration inspection, not a new network verification.

[`.env.example`](../.env.example#L1) uses `sslmode=require`. In the installed `pg-connection-string` 2.13.0, without libpq-compatibility mode, this currently aliases `verify-full`; the inspected local configuration uses that path. The parser warns that future major versions change the alias semantics. This is future compatibility risk, not evidence that current certificate verification is disabled.

**Baseline verification:** production settings must retain certificate and hostname verification. **Hardening:** an explicit `sslmode=verify-full` configuration, with a connectivity check, removes dependence on the changing alias behavior before driver upgrades. See [PostgreSQL's SSL-mode definitions](https://www.postgresql.org/docs/current/libpq-ssl.html).

## Implementation order and remaining verification

The next baseline priority is media cancellation (003), followed by input and abuse limits (004/005), and privacy wording (006). Actor and pair boundaries support the later abuse controls. Each control requires focused regression coverage and verification against the core journeys it affects.

Deployment readiness also requires verification of production headers and TLS, Mapbox public-token scopes and URL restrictions, and runtime database-role privileges. These account settings remain uninspected. A browser-visible Mapbox public token is expected and does not imply a leaked server secret. The separately documented acceptance-response-loss scenario remains unverified after the matching-end change; the core suite does not exercise that fault-injection case.
