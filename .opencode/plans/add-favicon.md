# Plan: Add Favicon to Site

## 1. Goal

Ensure the site displays a correct favicon in all major browsers. The project already has a working SVG favicon wired up in `frontend/index.html`. This plan covers two scenarios: (A) confirming the existing favicon is acceptable (zero code changes), or (B) replacing it with a new design and optionally adding fallback formats for legacy browsers and PWA installs.

**Acceptance criteria:**
- Browser tab shows the intended favicon icon after page load.
- `vite build` completes without errors and the built `dist/` folder contains the favicon file(s).
- (Optional extension) `apple-touch-icon` and a 32x32 PNG fallback are served correctly.

---

## 2. Files

| # | Path | Action |
|---|------|--------|
| 1 | `frontend/public/favicon.svg` | **Review or replace** — the existing SVG favicon file. |
| 2 | `frontend/index.html` (line 5) | **Possibly edit** — update `<link rel="icon">` if filename or type changes. |
| 3 | `frontend/public/favicon-32x32.png` | **Optional create** — PNG fallback for legacy browsers. |
| 4 | `frontend/public/apple-touch-icon.png` | **Optional create** — 180x180 PNG for iOS home-screen. |

---

## 3. Step-by-Step Actions

### Decision Point: Is the existing `favicon.svg` acceptable?

#### Path A — Existing favicon is fine (no changes)
1. Open `frontend/public/favicon.svg` in a browser or editor and visually confirm it matches the desired icon.
2. Run `npm run dev` (or equivalent) and verify the icon appears in the browser tab.
3. **Done.** No code changes required.

#### Path B — Replace with a new favicon
1. Obtain the new favicon design as an SVG file.
2. Replace the contents of `frontend/public/favicon.svg` with the new SVG.
3. If the filename or MIME type changes, update line 5 of `frontend/index.html`:
   ```html
   <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
   ```
   Adjust `type` and `href` attributes accordingly.
4. Run `npm run dev` and verify the new icon appears in the browser tab.

### Optional Extension: Fallback formats (legacy browsers + PWA)
5. Generate a 32x32 PNG from the SVG (e.g., via Inkscape, Sharp, or an online converter) and save as `frontend/public/favicon-32x32.png`.
6. Generate a 180x180 PNG and save as `frontend/public/apple-touch-icon.png`.
7. Add the following lines inside `<head>` in `frontend/index.html`, **after** the existing SVG `<link>`:
   ```html
   <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
   <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
   ```

---

## 4. Verification

| Check | How |
|-------|-----|
| Visual — dev server | Run `npm run dev`, open `http://localhost:5173`, confirm favicon in browser tab. |
| Visual — production build | Run `npm run build && npm run preview`, confirm favicon in browser tab. |
| Build artifact | Inspect `frontend/dist/` — confirm `favicon.svg` (and any PNGs) are present. |
| Lighthouse / DevTools | Open DevTools > Application > Icons — verify all declared icons load without 404. |
| (Optional) Mobile check | Open site on iOS Safari, use "Add to Home Screen" — confirm apple-touch-icon renders. |

---

## 5. Out of Scope

- Full PWA manifest (`manifest.json`) with multiple icon sizes.
- Dynamic/animated favicons.
- Dark-mode-aware favicon variants.
- Any changes to the application logic, routing, or components.
