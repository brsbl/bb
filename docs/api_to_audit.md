# APIs To Audit

Public surfaces shipped under an `experimental_` prefix. Each is functional
and covered by tests, but its contract has not soaked under real third-party
usage yet. Before renaming one to its stable name (a breaking rename — the
plugin SDK is pre-1.0, so minor bumps are breaking), audit it against the
questions listed with it, then remove it from this file in the same change.

## Plugin manifest

### `bb.branding.experimental_icon`

An optional plugin-relative compact SVG path beginning with `./`, such as
`./assets/icon.svg`. BB validates and hash-serves the SVG, then renders it as a
`currentColor` CSS mask across compact plugin chrome. The existing
`bb.branding.icon` field remains the stable host icon-name hint. Plugin
inventory exposes the resolved asset as `experimental_iconUrl`.

Audit before stabilizing:

- Do real third-party icons remain legible at every compact size and theme?
- Is a CSS mask sufficient, or do any valid icons need multicolor rendering?
- Should stabilization rename both manifest `experimental_icon` and inventory
  `experimental_iconUrl`, or replace the named and asset fields with a
  discriminated icon source?
- Does requiring a `./` plugin-relative path remain clear once more manifest
  assets exist?

## `@bb/plugin-sdk/app`

### `app.experimental_contentScripts`

Lifecycle-managed trusted same-origin frontend behavior. Registrations are
`{ id, mount({ pluginId, generation, signal }) }`; mount may return nothing, a
disposer, or a promise of either. The host mounts in declaration order,
aborts before reverse-order exact-once cleanup, never overlaps generations,
rolls back failed candidates, and owns one independent generation per app
window/tab.

Audit before stabilizing:

- Is the mount timeout (10 seconds) the right policy, and should plugins be
  able to request a shorter bound?
- Is `generation` useful enough to keep, and should it count failed candidate
  attempts or only committed generations?
- Do stable navigation/context subscriptions belong here, or should lifecycle
  code remain deliberately page-global while React hooks own route context?
- Is returning a disposer plus `AbortSignal` sufficient for partial mounts, or
  should a future context expose additive cleanup registration?

### `PluginContentScriptContext.experimental_rpc`, `.experimental_realtime`, and `.experimental_navigate`

Lifecycle-managed content scripts receive plugin-scoped RPC, realtime
subscriptions plus connection state, and root-composer navigation without
mounting React. The matching test harness controls are also experimental:
`ContentScriptTestMountOptions.experimental_rpc`,
`.experimental_realtimeConnectionState`,
`inspection.experimental_rpcCalls`, `inspection.experimental_navigateCalls`,
`behavior.experimental_publishRealtime`, and
`behavior.experimental_setRealtimeConnectionState`.

Audit before stabilizing:

- Should content scripts receive the complete hook-equivalent clients, or a
  smaller capability set tailored to imperative lifecycle code?
- Are automatic abort-bound realtime disposers sufficient, or should the
  context expose additive cleanup registration?
- Should navigation remain limited to `toCompose`, and how should unavailable
  navigation surfaces report failure?
- Does the test harness expose the minimum controls needed to verify transport,
  connection, and navigation behavior?

### `BbNavigate.experimental_openThreadPanel`

A general plugin-navigation method that opens one of the current plugin's
registered `threadPanelAction` tabs in the current thread surface. It accepts
`{ actionId, title?, params? }` and returns whether the host accepted the
request. The workflows banner and the Docs, Tasks, and workflows message
directives are reference consumers.

Audit before stabilizing:

- Should panel opening remain part of `useBbNavigate`, or become a separate
  navigation hook?
- Is a false return sufficient for surfaces without a thread panel, or should
  availability be separately observable for hiding controls?
- Should a future form accept an explicit thread id for surfaces outside the
  current thread tree?

### `experimental_ThreadChat`

The host-owned chat component: given a `threadId`, renders bb's complete chat
surface (timeline, streaming, composer, drafts, send/queue/steer/stop,
attachments, execution controls, pending interactions, read tracking) anywhere
plugin React runs — nav panels, thread-panel tabs, homepage/settings sections.
Props: `threadId`, `variant: "full" | "compact" | "timeline"`,
`layout: "contained" | "document"`, `focusRequest`, `className`, plus
`leadingContent` (rendered above the conversation) and `messageActions`
(per-instance actions receiving a `ThreadChatMessageReference`).

Audit before stabilizing:

- Is the `variant`/`layout` split the right axis, or should presentation be a
  single mode enum once more consumers exist?
- Do `leadingContent`/`messageActions` stay, or migrate to slots once the
  side-chat plugin is no longer the only consumer?
- Does `focusRequest` (change-detected nonce) hold up, or should focus be an
  imperative handle?

### `experimental_Markdown`

The host-owned chat-message markdown renderer: `{ content, className? }`
rendered with exactly the timeline's typography, spacing, and code styling.
For plugin UI that quotes or previews message content (e.g. the side-chat
"Replying to" header) so it reads like the rest of the chat. Renderer options
beyond content/className (lightbox, link routing, thread mentions) are
deliberately host-internal.

Audit before stabilizing:

- Which renderer options genuinely need exposure (link routing came up first
  in ThreadChat's internal mention resolver)?
- Should it clamp/fade long content itself instead of every consumer
  reimplementing overflow handling?

### `app.slots.experimental_messageAction`

A plugin-contributed action on chat messages: an icon button in the
per-message action bar (user and assistant messages) and an entry in the
assistant text-selection menu. Registration
`{ id, title, icon?, experimental_placements?, run }`; `run(context)` receives
`{ threadId, message: ThreadChatMessageReference, selectedText?,
experimental_selection?, openPanel({ actionId, title?, params? }) }`. The
experimental selection contains rendered-text UTF-16 offsets, quote context,
and viewport line-fragment geometry. Its exported helper types are
`experimental_PluginMessageActionPlacement` and
`experimental_PluginRenderedTextSelection`. Errors are contained and logged.
The side-chat plugin's "Reply in side chat" and Timeline Comments are reference
consumers.

Audit before stabilizing:

- Should registrations support `roles` filtering like per-instance
  `ThreadChatMessageAction` already does?
- Is `openPanel`-only the right navigation affordance, or do actions also
  need `useBbNavigate`-style routing from `run`?
- Is `experimental_placements` the right opt-in shape, including omission
  meaning both action-bar and selection-menu placement?
- Are rendered-text UTF-16 offsets plus prefix/suffix context sufficient for
  durable re-anchoring across Markdown rerenders?
- Should viewport rectangles stay in the activation payload, or should plugins
  resolve geometry from a stable selector when needed?
- Ordering/dedup policy when several plugins contribute actions.

### `PluginThreadPanelProps.experimental_revealMessage`

Reveals a native user or assistant message in the panel's thread. The host
loads bounded older history, expands containing groups, centers the stable row,
and resolves only after its canonical prose root mounts.

Audit before stabilizing:

- Is `"revealed" | "missing"` enough result detail for plugins to recover or
  explain failures?
- Should the method accept an explicit reveal alignment or animation policy?
- Are the older-history bounds and five-second mount deadline appropriate for
  large threads and slow clients?

### Experimental native timeline DOM hooks

Content scripts can locate native timeline boundaries and message prose through
`data-bb-experimental-thread-window`,
`data-bb-experimental-thread-scroll-root`,
`data-bb-experimental-conversation-message-id`,
`data-bb-experimental-message-role`, and
`data-bb-experimental-message-prose-root`. Embedded plugin chats omit these
hooks.

Audit before stabilizing:

- Can the selector set be reduced while still supporting annotation layout and
  exact-range restoration?
- Should message role remain a DOM attribute or come from the action payload?
- Are the hooks unique and stable across grouped turns, older-history loading,
  streaming, and embedded chat surfaces?

### `threadPanelAction.layout` (registration field)

Not a new member, but new contract surface on an existing registration:
`layout?: "padded" | "flush"` controls how the host frames a panel tab —
`"padded"` (default) is the padded scroll container; `"flush"` hands the
component the full tab area (definite height, no padding or host
scrolling), which app-like content such as `experimental_ThreadChat` needs
to align with the main thread's composer baseline.

Audit before stabilizing: whether `layout` belongs on the registration (one
value per action) or on `openPanel` (per tab), and whether other slot kinds
(navPanel) need the same knob.
