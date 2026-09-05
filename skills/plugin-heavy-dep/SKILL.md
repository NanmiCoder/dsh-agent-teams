---
name: plugin-heavy-dep
description: Use when adding a heavyweight browser dependency (diagram/chart renderers like mermaid, code editors, big wasm-adjacent libs) to a lightweight DSH Web plugin that must stay small, when wiring a lazy-loaded chunk through a host route, when the lazy import intermittently fails or falls back, or when rendering untrusted markup (SVG/HTML) produced by such a dependency.
---

# Add Heavy Dependencies to a Lightweight DSH Web Plugin

A lightweight Web plugin (small client bundle, no build farm) can still ship a
multi-megabyte renderer — if the heavy code never loads until it is needed and
degrades gracefully when it cannot load. This skill is the integration
checklist; every item below was earned from a real mermaid integration.

## 1. Decide lazy vs inline

If the dependency would multiply the client bundle several-fold and only one
feature needs it (a fence renderer, an editor opened on demand), do NOT inline
it into the client bundle. Split it into a **separate chunk file** the client
imports dynamically only when the feature actually renders.

## 2. Bundle the chunk as ONE file

Bundle the dependency into a **single self-contained ESM file** with
code-splitting disabled. A general-purpose bundler left on default settings
splits the library's internal dynamic imports into sibling chunk files with
content-hashed names — the browser then resolves them as relative imports
against the chunk's URL, and every sibling must also be served, named exactly,
and MIME-correct. One file, one import, no relative-resolution class of bugs.

## 3. Serve it from a host route scoped to your own lib

Register a **prefix route** on `webServer` that serves files from the plugin's
own lib directory only:

- Resolve the lib directory from the host bundle itself (`import.meta.url`),
  never from `process.cwd()`.
- Restrict to a whitelist of extensions (your chunk is `.js`/`.mjs` — nothing
  else should ever be served).
- Containment guard: verify the requested path stays inside the lib dir. Two
  hard-won rules:
  - **Compare with `path.relative`, not `startsWith`**: a prefix compare is
    wrong the moment the filesystem normalizes differently than your base
    string.
  - **Windows drive letters change case**: `realpathSync` may return `e:\…`
    where your base says `E:\…`; a case-sensitive compare then misjudges a
    perfectly contained path as an escape and answers **403**. `path.relative`
    (plus an `isAbsolute` check on the result for cross-drive) is robust.
- Serve with a JavaScript MIME (`application/javascript`) — a wrong MIME makes
  the browser reject the dynamic import.

Remember: the host route only exists after a **dsh restart**; a hard refresh
alone does not register new host code. A 404 on a freshly added route almost
always means "not restarted yet" or "the installed copy predates the route".

## 4. Import lazily, cache verdicts, fall back

- `import()` the chunk URL on first render of the feature; **cache the
  successful module** so repeated fences do not re-import.
- **Do not cache failures** the same way — or a transient failure sticks for
  the page lifetime; let the next attempt retry, but throttle (a failing
  import in a loop is its own console spam).
- Always render a **fallback** (e.g. the original code block) when the import
  or the render throws; reading must never break because a diagram could not
  load. Tag the fallback with a state attribute and log the failure reason to
  the console — "it fell back" without a reason is undebuggable.

## 5. Untrusted markup: sanitize before innerHTML

A renderer fed untrusted text (markdown, model output) emits markup you must
treat as hostile before `dangerouslySetInnerHTML`:

- Configure the renderer to its strict mode and to emit **real SVG text**
  rather than HTML labels (HTML labels ride inside `<foreignObject>` — the
  one channel that carries raw HTML inside an SVG).
- Suppress the library's global error side effects (some renderers dump a
  giant error SVG into `document.body` before rejecting).
- Then **re-sanitize the emitted SVG yourself** with a zero-dependency
  whitelist pass: parse as XML (`image/svg+xml`; a parse failure rejects the
  whole string), accept only an `<svg>` root, strip `foreignObject`/`script`
  and foreign-HTML elements case-insensitively, strip `on*`/`@*` attributes,
  and strip **all** `href`/`xlink:href` (static diagrams gain nothing from
  links; a hostile href can navigate the GUI). Defense in depth, not
  defense instead.

## 6. Interaction ownership under a modal

A fullscreen zoom/pan modal over the plugin's panels must own ALL wheel
events while open — including Ctrl+wheel, if the underlying pane already
binds Ctrl+wheel (font sizing). Guard the pane-level handler with a modal
presence check; otherwise both behaviors fire on one gesture. Modal zoom:
wheel anchored at the cursor, drag to pan, keyboard shortcuts, Esc/overlay
click to close.

## 7. Ship it

- Commit the built chunk to the package (the plugin ships `lib/`); declare it
  in `files` so published payloads stay closed.
- Document the restart requirement (host route) vs refresh-only (client) in
  the release notes — users hit 404s otherwise.
- A regression test per pitfall: the fallback path (chunk import fails →
  original rendering), the sanitizer (strips the hostile channels), and — for
  the host route — a containment test that a case-differing but contained path
  is served, not refused.
