# Initial security review

Reviewed 2026-10-08 at commit `b7c7fb6`. This is the initial triage; the proposed fixes have not been implemented.

The highest priorities are session ownership, server-side connection authorization, and cancellation of pending camera/microphone acquisition. Anonymous use needs a private way to prove session ownership, separate from the dot IDs shared on the map. Existing input validation and transactions do not establish that ownership or connection consent.

## Scope and evidence

- Reviewed all four API routes, request parsing, Prisma queries/schema, WebRTC/media lifecycle, browser rendering, privacy wording, and repository configuration.
- Executed the actual route and peer-session code with synthetic requests, an in-memory database double, and controlled media/RTC doubles. These reproduce the application behavior below; they do not establish deployed exploitability, native device behavior, or PostgreSQL concurrency behavior. No live database, real media, or public deployment was probed.
- `npm audit --json --ignore-scripts` completed with **zero reported vulnerabilities** across the current dependency tree. This is a known-advisory check, not a security guarantee.
- A targeted scan of 142 historical text blobs reachable through local Git refs found no matches for the selected private-key, secret-token, or non-placeholder database-password patterns. Environment/private-context files are excluded; only `.env.example` appears in the tracked environment-file history. This was not an exhaustive secret-detector scan.
- The developer reports a fresh full E2E and unit/integration suite passing. Those suites were not rerun for this review. Passing functional journeys do not establish the hostile-input and authorization properties reviewed here.

## Triage

Severity describes impact; phase describes the proposed delivery order.

| ID  | Severity | Finding                                                     | Deploy-ready baseline                                        | Later hardening                                      |
| --- | -------- | ----------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| 001 | High     | Public IDs authorize private session operations             | Add per-session ownership checks                             | Review expiration/replay behavior                    |
| 002 | High     | Signals can change unrelated connections without consent    | Enforce server-owned request/pair state and atomic admission | Broaden concurrency and delayed-write testing        |
| 003 | High     | Late media acquisition survives stop/disconnect             | Cancel acquisition logically and stop late tracks            | Native-device timing checks                          |
| 004 | Medium   | Request and signaling validation is incomplete              | Bound bodies/IDs and validate payloads by signal type        | Extend malformed-input coverage as needed            |
| 005 | Medium   | Coordination work and storage lack application abuse limits | Set and verify practical request/queue budgets               | Adaptive controls and broader load testing           |
| 006 | Medium   | Privacy copy overpromises storage and deletion behavior     | Correct the copy and disclose coordination/network metadata  | Bound physical retention independently of visitors   |
| 007 | Medium   | Peer messages and client collections are unbounded          | Keep accepted-peer trust assumptions explicit                | Cap messages, history, candidates, and control input |
| 008 | Medium   | Polar inputs can defeat the privacy offset                  | Record the geographic limitation                             | Use a geodesic offset with boundary checks           |
| 009 | Low      | Security-header policy is not configured in the app         | Verify deployed headers/configuration                        | Add compatible CSP/framing/cache policies            |
| 010 | Low      | Database TLS mode relies on changing alias behavior         | Verify production certificate validation                     | Make `verify-full` explicit before driver upgrades   |

## High severity

### 001: Public session IDs are treated as proof of ownership

**Rule:** `NEXT-AUTH-001` / object-level authorization. **Evidence:** confirmed route behavior with a database double.

[Polling](../app/api/poll/route.ts#L14) accepts the query-string ID, returns public peer IDs, then reads and deletes the mailbox selected by `where: { toId: id }`. [Leave](../app/api/leave/route.ts#L25) deletes records using the submitted ID. [Join](../app/api/join/route.ts#L49) upserts that ID; [signal](../app/api/signal/route.ts#L60) trusts the submitted `fromId`.

**Impact:** someone who learns a public dot ID can impersonate that session, read/consume its signaling, or remove its presence. The probes reproduced unauthorized mailbox consumption and deletion. Interception of actual chat/video was not attempted.

**Baseline fix:** issue a private, unguessable per-session credential separately from the public dot ID. Verify ownership for join/update, poll, leave, and signaling; derive the acting session from verified credentials. Keep credentials out of map responses, URLs, logs, and persistent browser storage. Preserve fresh per-tab sessions and beacon-compatible departure. Random public UUIDs alone do not address this issue. This matches [OWASP's object-authorization guidance](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).

### 002: Connection consent and reservation ownership are not enforced by the server

**Rule:** `NEXT-AUTH-001` / connection authorization. **Evidence:** confirmed sequential route behavior; concurrent database admission remains untested.

[Signaling](../app/api/signal/route.ts#L61) checks the target's existence/busy flag only for `request`. The `accept`/`end` branch updates both submitted IDs and saves the signal in a transaction, without checking a pending request, current partner, or connection attempt.

**Impact:** an `accept` without a preceding request reserves both participants. A registered third participant's `end` clears another participant's busy flag even when that participant belongs to a different conversation. Both were reproduced. Making those writes atomic does not authorize them.

**Baseline fix:** enforce valid request/accept/active-pair transitions in server-owned state. Accept only a matching pending request, verify both participants are available when claiming the connection, and permit negotiation/end only for the relevant pair/attempt. Cleanup must release that reservation without changing an unrelated or newer connection. Use conditional transactional admission; add a real-database concurrency check when implementing it. Session ownership in 001 is necessary but does not replace these checks. Until both are addressed, restrict public exposure.

### 003: Camera/microphone acquisition can complete after consent has been withdrawn

**Rule:** application media-consent/lifecycle boundary. **Evidence:** confirmed with synthetic media and RTC doubles.

[`startVideo`](../lib/webrtc.ts#L199) assigns the result of `getUserMedia` and attaches its tracks after the await. [`stopVideo`](../lib/webrtc.ts#L212) stops only an already-assigned stream; [`close`](../lib/webrtc.ts#L259) does not invalidate pending acquisition. The [page callbacks](../app/page.tsx#L195) can also set video active after an old acquisition completes.

**Impact:** stopping video while acquisition is pending can still attach the returned tracks to the live peer. Closing the peer first causes track attachment to fail, but the acquired tracks remain unstopped. The probes establish those lifecycle errors; no camera or microphone was opened during the review.

**Baseline fix:** invalidate pending acquisition on stop/close and immediately stop tracks returned for a cancelled acquisition. Share one pending acquisition per attempt, and guard page success/failure callbacks against a changed peer or video attempt. Add focused delayed-acquisition regressions before changing the code.

## Medium severity

### 004: Validation happens after unrestricted body parsing and does not validate signaling structure

**Rule:** `NEXT-INPUT-001` / `NEXT-DOS-001`. **Evidence:** confirmed route behavior; hosting-layer limits were not exercised.

The [JSON reader](../lib/request.ts#L7) fully parses the body before validation. [Signal IDs](../app/api/signal/route.ts#L14) accept any string, unlike join's bounded ID rule. The payload's 64 KiB limit counts UTF-16 code units after parsing; it does not bound the complete request in bytes or validate the enclosed SDP/ICE JSON. Leave/poll also use different ID rules.

**Impact:** empty IDs and malformed signaling payloads are stored. A body over 512 KiB containing an ignored extra field was parsed and accepted by the actual handler. Large/invalid input can waste parser/database/browser work; no resource-exhaustion attack was run.

**Baseline fix:** apply a small byte limit before parsing, consistent bounded ID validation, and signal-specific payload schemas. Reject invalid/self-targeted operations and absent participants as appropriate to 002. Preserve the `sendBeacon` text-body path. Unknown fields must be covered by the total-body limit even if the schema strips them.

### 005: Coordination endpoints expose unbounded work and storage

**Rule:** `NEXT-DOS-001`. **Evidence:** static application finding; deployed edge controls are unknown.

Join can create arbitrarily many sessions; signal writes have no per-actor or queue budget. [Polling](../app/api/poll/route.ts#L31) performs global cleanup and unbounded peer/mailbox reads. Individual database timeouts do not limit the number of calls or rows.

**Impact:** repeated requests can consume database, function, and client resources. A per-payload size cap alone cannot bound aggregate traffic or queue growth. This is the resource-control boundary described by [OWASP API4](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption/).

**Baseline fix:** choose practical join/signaling/poll limits and bound queued signals and poll batches, preserving legitimate polling/ICE bursts. Verify shared database or deployment-edge enforcement; process-local counters alone do not cover multiple serverless instances. Check existing hosting controls before introducing infrastructure. Broader load testing is hardening work, not a prerequisite to choosing those basic limits.

### 006: Privacy wording promises more than the implementation guarantees

**Rule:** application privacy/retention requirements. **Evidence:** static data flow and cleanup review; infrastructure retention was not inspected.

[EntryGate](../app/components/EntryGate.tsx#L59) says nothing is stored and closing the tab ends everything. The [schema](../prisma/schema.prisma#L14) stores offset coordinates and signaling payloads. Cleanup runs on leave or poll; stale-time constants are eligibility thresholds, not an independent deletion timer. When all visitors stop polling and departure is lost, rows remain until another cleanup call. Raw location also reaches join before offsetting; chat/video content has no server-side storage path in the reviewed code. WebRTC signaling may contain network addresses, as described in the [W3C security/privacy considerations](https://www.w3.org/TR/webrtc/#security-and-privacy-considerations).

**Baseline fix:** accurately distinguish peer-to-peer chat/video from transient server coordination, disclose the limits of location offsetting and peer network exposure, and describe departure as best-effort cleanup with stale-session removal. **Hardening:** add bounded physical cleanup independent of visitors and verify provider/log/backup retention before making stronger deletion promises. Existing external cleanup could alter the retention assessment; none is configured in this repository.

### 007: A connected peer can supply unbounded data to the browser

**Rule:** runtime input/resource bounds at the peer boundary. **Evidence:** static finding; no browser stress test was performed.

The [data-channel handler](../lib/webrtc.ts#L98) accepts chat strings without length/rate limits and casts control strings to `PeerControl`. [Message history](../app/page.tsx#L123) and [pending ICE candidates](../lib/webrtc.ts#L136) grow without explicit bounds.

**Impact:** a malicious accepted peer can grow client memory and rendering work. React escapes message text; this finding is resource abuse, not a demonstrated XSS issue.

**Hardening:** validate incoming envelopes/controls, bound chat length and history, and cap candidate queues/message rates. Prioritize sooner if hostile-peer resilience becomes a baseline acceptance requirement.

### 008: Privacy offsetting fails at geographic boundaries

**Rule:** the required 1-3 km offset. **Evidence:** reproduced with synthetic coordinates and controlled randomness.

The [offset function](../lib/geo.ts#L15) approximates degree distances and clamps latitude. Valid input at the north pole with a northward bearing returns the original physical point: the demonstrated distance is zero rather than 1-3 km.

**Hardening:** use a geodesic destination calculation and independently verify output distances near poles and the date line. The current ordinary-location browser checks do not establish this boundary behavior. This can be addressed independently of API ownership and consent.

## Low severity / configuration verification

### 009: App-level security headers are not configured

**Rule:** `NEXT-HEADERS-001` / `NEXT-CSP-001`. **Evidence:** configuration observation; deployed response headers were not checked.

[`next.config.ts`](../next.config.ts#L3) configures a development origin but no header policy. No CSP/framing policy or explicit server `Cache-Control: no-store` is configured for the signaling mailbox. Next's `force-dynamic` routes and the client's no-store polling already reduce caching risk; a cache leak was not demonstrated.

**Baseline verification:** inspect actual production headers and edge settings. **Hardening:** add appropriate anti-framing, content-type/referrer/permission policies, explicit sensitive-response caching rules, and a CSP compatible with Next and [Mapbox's worker requirements](https://docs.mapbox.com/mapbox-gl-js/guides/security-and-testing/). Missing CSP is not proof of XSS: chat uses escaped React text, and the map's `innerHTML` assignment contains a fixed application-authored string.

### 010: TLS verification depends on a deprecated SSL-mode alias

**Rule:** database transport configuration. **Evidence:** installed parser/configuration inspection, not a new network verification.

[`.env.example`](../.env.example#L1) uses `sslmode=require`. In the installed `pg-connection-string` 2.13.0, without libpq-compatibility mode, this currently aliases `verify-full`; the inspected local configuration uses that path. The parser warns that future major versions change the alias semantics. This is future compatibility risk, not evidence that current certificate verification is disabled.

**Baseline verification:** confirm production settings retain certificate and hostname verification. **Hardening:** explicitly choose `sslmode=verify-full` and verify connectivity before future driver upgrades; do not silence the warning by disabling verification. See [PostgreSQL's SSL-mode definitions](https://www.postgresql.org/docs/current/libpq-ssl.html).

## Implementation order and remaining verification

Start with 001, then 002; their actor/pair boundaries are prerequisites for meaningful authorization and per-session abuse controls. Fix 003 as its own media-lifecycle change. Follow with 004/005 and the baseline wording in 006. Keep each fix and its focused regression coverage together for review, then rerun the existing core journeys after the relevant boundaries change.

Before declaring deployment readiness, verify production headers/TLS, Mapbox public-token scopes/URL restrictions, and runtime database-role privileges. These account settings were not inspected; their absence is not asserted. A browser-visible Mapbox public token is expected, not a leaked server secret. Also retain the separately documented acceptance-response-loss recovery defect: the green core suite does not exercise its deferred fault-injection case.
