---
name: share-server-links
description: Share a local HTTP server with the user over bb connect. Use when an agent has started a local HTTP server (dev server, preview, static server) and wants to hand the user a link they can open — especially remotely ("start the dev server", "let me see it", "preview", "open it on my phone", "share a link"). Prefer this over pasting localhost URLs when bb connect may be paired.
---

# Share local server links via bb connect

When you start an HTTP server the user should open, give them a portable BB
service link instead of choosing a localhost or Connect URL. BB resolves that
one link when it is opened: local BB uses loopback; BB Connect uses the
verified share for the environment host.

1. From the thread that started the HTTP server, run `bb connect expose
<port>` when Connect viewers need it. Use `--host <name-or-id>` only when you
   intentionally need another enrolled host; outside a thread, sharing
   defaults to the machine running the bb server.
2. Run `bb connect link <port> [--path /optional/path?query#hash]` from the
   same thread. It prints the canonical relative BB link for that environment
   host. Give that returned path to the user as a Markdown link.
3. If Connect is unavailable, the canonical link still works for a local
   viewer on the service host. A remote viewer gets a clear unavailable state
   until the service is shared; never substitute a guessed Connect URL.
4. When the server stops, run `bb connect unexpose <port>` from the same
   thread (or with the same `--host`) so the share is cleaned up. Use
   `bb connect shares [--host <name-or-id>]` to inspect that host's shares.

Server-host shares use `https://<server-label>--<port>.<base-domain>` through
the server tunnel. Other enrolled hosts use
`https://<machine-label>--<port>.<base-domain>` through their daemon. If a
machine was not enrolled through Connect, expose fails with instructions to
remove and re-add it under Settings > Machines.
