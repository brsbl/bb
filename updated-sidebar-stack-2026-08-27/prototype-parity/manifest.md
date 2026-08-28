# Updated Sidebar prototype parity

Result: **PASS — 21/21 captured states across all five canonical HTML prototypes.**

- Canonical spec: `/Users/brsbl/Moss/Notes/Updated Sidebar Spec/Updated Sidebar Spec.md`
- Spec SHA-256: `06ef18e7042ee1012b4391ec73b771ef0123129ad47103027a68349c57d9130d`
- Cumulative implementation: `6278f2b81cea120828a02e2f901c58735b863ea0` (#2501 exact head)
- Browser: Google Chrome for Testing 151.0.7922.71
- Theme and viewport: light, 1440×900; compact state 700×900
- Method: one isolated branch web app, one long-lived Chrome-for-Testing session, equivalent fixture labels/data, and paired captures for each materially distinct state

The prototype fixture originally contradicted its own approved `drafts-pinned` decision by placing the first active-group header above local drafts. The canonical HTML was corrected so drafts render unlabelled above the first active group, matching the written contract, resolved comment, tests, and implementation. Only the four affected prototype screenshots were recaptured. Product code did not change during this pass.

## Per-node checklist

The composite sheet for each flow places the prototype on the left and the exact implementation on the right. Rows appear in the state order listed below.

### Flow 1 — Shape and customize the sidebar

Composite: `flow1-prototype-parity.png`

- [x] Initial — stable bb-owned, Plugins, and thread regions; no sidebar search field
- [x] Customized — Automations reordered first and Extensions hidden while the menu remains open
- [x] All hidden — bb-owned rows and their divider collapse; Customize remains reachable
- [x] Manual + off-default filter — unlabelled draft above Pinned, named Design section, Threads catch-all, inline Filter with dot, Active + Drafts selected

Observed interaction: pointer drag reordered only the three bb-owned rows; checkbox changes applied immediately; hiding all three preserved the top-chrome recovery control; organization/filter changes applied without row-height or control-position shift.

### Flow 2 — Choose visible thread states

Composite: `flow2-prototype-parity.png`

- [x] Default — Active only, no filter dot
- [x] All states — Draft above active rows; Archived trailing; state text at the right edge; no counts
- [x] Unarchive focus — right-edge Archived state yields to Unarchive on focus
- [x] Empty — final archived removal shows `No threads match this filter.` while the inline recovery control remains available

Observed interaction: the final selected lifecycle state could not be deselected; Unarchive removed its row immediately; the filter trigger moved to the applicable fallback header when no active group remained.

### Flow 3 — Search commands and threads

Composite: `flow3-prototype-parity.png`

- [x] Root — commands only in Threads, Actions, and Plugins buckets; no thread results
- [x] Ranked query — one flat relevance-ranked list using the existing muted group metadata and shortcut-pill anatomy
- [x] Thread mode — magnifier-only mode chip and one unlabelled active → draft → archived list, with Draft/Archived only at the right edge
- [x] Scoped — All scope is keyboard-reachable; Up/Down applies immediately; scoped result matches the selected lifecycle

Observed interaction: `Search threads` and Cmd+K entered thread mode; Enter/Escape from scope returned focus to the input; Escape returned thread mode to root, a second Escape closed; closing reset scope to All.

### Flow 4 — Plugin pages and overflow

Composite: `flow4-prototype-parity.png`

- [x] Collapsed — five traditional plugin pages and right-facing More plugins disclosure
- [x] Expanded — overflow inline with down-facing Show fewer disclosure
- [x] Menu — icon-labelled Move to top, Move to overflow, Open in split, Detail page, and Disable
- [x] Zero — the Plugins subsection, disclosure, and adjacent divider disappear together

Observed interaction: `...` and right-click opened the same host menu; moves applied immediately; Detail page routed to `/extensions/plugins/:pluginId`; Disable removed the row; Automations never entered plugin ordering or overflow.

### Flow 5 — Start and recover split drafts

Composite: `flow5-prototype-parity.png`

- [x] Action — Split appears only on hover/focus of New thread
- [x] Split — two blank independent panes open with the left pane focused
- [x] Independent — text, provider/model/reasoning, permission, environment, and `brief.md` attachment remain pane-local
- [x] Restored — hard reload and close/reopen preserve each draft payload; attachment remains only in the left pane
- [x] Compact — Split is absent in the compact drawer

Observed interaction: closing the right pane left its draft row in the sidebar; Open in split restored that exact slot and focused it; neither pane overwrote the sibling’s text or composer selection.

## Files

Each state has both `flowN-prototype-STATE.png` and `flowN-implementation-STATE.png`, plus the five `flowN-prototype-parity.png` composite sheets. There are 42 raw state captures and 5 composites.
