# Gate — handoff for Claude Code

Personal iOS prototype. Sideloaded via Xcode to one phone. No App Store, no polish.

## Thesis

Time-based screen limits are dumb: they can't tell "reading an article" from "phone
face-up while talking," and they're lumpy (20 min/day, not 2 min/hour). Replace them
with a **token bucket** that gates **entry points**, not time.

- Target apps (Instagram, Twitter/X) are shielded by default via the Screen Time API.
- The only way in is through Gate, which offers **leaf actions** — look up a user, open
  a specific post, post a story, open DMs, or a bounded feed session.
- Each action costs tokens, lifts the shield, deep-links to the leaf, and the shield
  comes back after a short usage window. Landing on a leaf is a soft sandbox; the short
  relock is what makes it hold.
- Tokens refill continuously (token bucket), so lookups are cheap and frequent,
  scroll sessions are expensive and rare.

## Prerequisites (do these before writing code)

1. Paid Apple Developer account. Free/personal teams cannot use the Family Controls
   capability, and third-party sideloaders strip the entitlement. Non-negotiable.
2. In the developer portal, enable **Family Controls (Development)** on the app ID and on
   each extension's app ID. No approval form needed for development builds.
3. An **App Group** (e.g. `group.dev.<you>.gate`) shared by the app and all extensions.
4. A real iPhone, iOS 17+. Family Controls does not work in the simulator.
5. Xcode. Deploy with the Run button; that is the entire deployment story.

## Targets

| Target | Framework | Job |
|---|---|---|
| `Gate` (app, SwiftUI) | FamilyControls, ManagedSettings | Authorization, app setup (picker), bucket ledger, action buttons, shield lift + deep link, log viewer |
| `GateMonitor` (DeviceActivityMonitor extension) | DeviceActivity, ManagedSettings | Reshield when usage threshold is reached; backstop reshield at schedule end |
| `GateShield` (ShieldConfiguration extension) — *optional, last* | ManagedSettings UI | Custom overlay text ("Open Gate to spend tokens"). Skip if the default shield is fine |

Extensions run under a ~6 MB memory limit. Keep them to a few lines; no SwiftUI, no
heavy dependencies, read/write shared state only through the App Group.

## Decisions (defaults — change in one place, `Config.swift`)

Gated apps for v1: **Instagram**, **Twitter/X**. Nothing else.

Bucket: capacity **10**, refill **1 token / 40 min**, refill **paused 22:00–07:00**.
Single bucket shared by all actions. **No notifications, ever** (no "tokens full").

| Action | App | Cost | Usage window | How it opens |
|---|---|---|---|---|
| Look up user | Instagram | 1 | 1 min | `instagram://user?username=<h>` |
| Story camera | Instagram | 0 | 3 min | `instagram://story-camera` |
| DM inbox | Instagram | 2 | 3 min | `https://instagram.com/direct/inbox/` (universal link) |
| Feed session | Instagram | 7 | 15 min | `instagram://` |
| Look up user | Twitter | 1 | 1 min | `x-safari-https://x.com/<h>` |
| Open tweet URL | Twitter | 1 | 1 min | `x-safari-https://<pasted url>` |
| Post | Twitter | 0 | 2 min | `twitter://post` |
| Feed session | Twitter | 7 | 15 min | `x-safari-https://x.com/home` |

Twitter opens in **Safari** (`x-safari-https://`) so the Control Panel for Twitter
extension applies (Following-only, no "For you"). Instagram opens the native app.
Also shield the web domains `instagram.com`, `x.com`, `twitter.com` so Safari isn't
a leak — *except* that Twitter actions need `x.com` reachable during the window, so
the lift step removes the domain shield too.

"Usage window" means **minutes of actual use of the target app**, enforced by a
DeviceActivity usage-threshold event, not wall-clock time. If the user never opens
the app, a 15-minute schedule end reshields as a backstop.

Shield lifting: **lift all shields, open the link, relock all** (option "lift-all").
With two gated apps this is fine and avoids needing to know which token is which.
Per-app lifting (store each token under a key from a "Set up Instagram" picker prompt)
is a later refinement.

## Shared state (App Group `UserDefaults` / small JSON file)

```
Bucket        { balance: Double, lastUpdated: Date }
Selection     FamilyActivitySelection (Codable) — apps + web domains to shield
ActiveWindow  { action: String, startedAt: Date, minutes: Int }?  — nil when shielded
RelockLog     [ { at: Date, reason: "threshold" | "scheduleEnd" | "manual" } ]  (cap 200)
```

Bucket balance is **computed on read**, never on a timer:
`balance = min(cap, stored + rate * refillableElapsed(since: lastUpdated))`
where `refillableElapsed` excludes the 22:00–07:00 pause. This survives app kill,
reboot, and phone off; there is no background process.

## Build order — each step has a check; do not proceed until it passes

Coding conventions for every step: comment the meaning of each line / semantic chunk,
and explain the *motivation* for additions, not just what they do. Keep each step
independently verifiable (unit test, on-device check, or log line) before moving on.

### Step 1 — Authorization + shield
- Add Family Controls capability to app; request `.individual` authorization.
- Present `FamilyActivityPicker`; persist the selection to the App Group.
- Write `selection.applicationTokens` to `ManagedSettingsStore().shield.applications`
  and `selection.webDomainTokens` to `.shield.webDomains`.
- **Check:** tap Instagram on the home screen → system shield overlay appears.
  Open `instagram.com` in Safari → shield appears.

### Step 2 — Lift + deep link (no relock yet)
- Button: clear `shield.applications` and `shield.webDomains`, write `ActiveWindow`,
  then `UIApplication.shared.open(url)`.
- **Check:** "Look up user" with a handle → lands on that profile, not the feed.
  Try each URL in the table once; note any that don't land where expected.
  Manual "Relock now" button restores shields from the persisted selection.

### Step 3 — Relock via usage threshold (GateMonitor)
- On lift, start monitoring:
  `DeviceActivityEvent(applications: selection.applicationTokens, webDomains: ..., threshold: DateComponents(minute: N))`
  inside a schedule from now to now + 15 min (15 min is the schedule minimum).
- In the extension: `eventDidReachThreshold` → restore shields from selection, clear
  `ActiveWindow`, append `RelockLog { reason: "threshold" }`.
  `intervalDidEnd` → same with `reason: "scheduleEnd"`; stop monitoring.
- **Check:** look up a user (1 min), stay in Instagram → shield returns after ~1 min of
  use (expect up to ~30 s lag). RelockLog shows a `threshold` entry. Leave the app
  immediately instead → no threshold; shield returns at 15 min with `scheduleEnd`.
- Extension memory: confirm it's a few lines; watch for crashes in Console.

### Step 4 — Bucket arithmetic (pure Swift, unit-tested)
- `TokenBucket` struct: `capacity`, `refillPerMinute`, `pause: ClosedRange<Hour>`,
  `balance(at:)`, `spend(_:at:) -> Bool`.
- **Check (tests):** full bucket stays full; spend then wait refills at rate; no refill
  across the pause window; spend fails when insufficient; caps at capacity.

### Step 5 — Action UI
- One screen: balance readout (with "next token in N min"), action list per app, handle
  / URL entry sheet, and a RelockLog view.
- Actions gated by bucket: disabled when unaffordable; spend on tap, then Step 2 flow.
- **Check:** end-to-end on device: 10 tokens → lookup (9) → story (9) → feed (2) →
  feed disabled → wait 40 min → 3.

### Step 6 — Optional polish
- `GateShield` extension with custom overlay text.
- Per-app token keys ("Set up Instagram" prompt) instead of lift-all.
- Separate slower bucket for feed sessions if lookups start subsidising scrolls.

## Known constraints (don't fight these)

- `ApplicationToken` / `WebDomainToken` are opaque; you cannot read a bundle ID or
  name. `Label(token)` renders the icon/name; your code can only key tokens by the
  prompt that produced them.
- ShieldAction extension can only return `.close` / `.defer` / `.none`; it cannot
  open Gate. (Out of scope; user opens Gate manually.)
- DeviceActivity schedules: 15-minute minimum. Threshold events can lag.
- Extensions: ~6 MB memory limit.
- Custom URL schemes are undocumented and drift. Universal links
  (`https://instagram.com/...`, `https://x.com/...`) route into the app when installed
  and are more durable; prefer them where they land on the same leaf. Authoritative
  path list: `https://<domain>/.well-known/apple-app-site-association`.
- `x-safari-https://` forces real Safari (needed for Safari extensions to run).

## Non-goals

Anti-tamper (uninstall protection), App Store distribution, YouTube (handled later by
an RSS/embed reader, separate project), TikTok (no leaves; timed-unlock only), any
notification, any streaks / gamification beyond the bucket itself.

## Open questions to resolve during Step 2

- Does the web-domain shield apply inside Gate's own `WKWebView`? (Matters only for the
  later RSS/YouTube-embed reader; note the result.)
- Which Instagram/Twitter URLs in the table actually land on the leaf on the current
  app versions? Replace any that don't with the universal-link form.
