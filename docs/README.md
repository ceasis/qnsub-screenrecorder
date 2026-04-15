# docs/ — GitHub Pages landing site

This folder is the source of the project's marketing / download
landing page, served at **https://ceasis.github.io/qnsub-screenrecorder/**
(or whichever path your GitHub account/repo resolves to).

It's a single `index.html` with everything inlined — CSS, SVG icons,
no external assets, no build step. You can open `docs/index.html`
directly in a browser to preview changes locally; GitHub Pages just
hosts the same file unchanged.

## How to enable GitHub Pages for this repo

One-time setup per repository (not per commit):

1. Push this folder to the `main` branch (or whichever branch the
   repo's default points at). Make sure `docs/index.html` is
   committed.
2. Go to the repo on GitHub → **Settings** → **Pages** (in the
   left sidebar, under "Code and automation").
3. Under **Build and deployment**:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` (or `master`)
   - **Folder**: `/docs`
4. Click **Save**.
5. GitHub shows "Your site is live at https://<user>.github.io/<repo>/"
   within 1–2 minutes. The green checkmark next to the deployment
   in the Actions tab confirms the build succeeded.

That's it. Every future push to `main` that changes anything under
`docs/` triggers a Pages redeploy automatically.

## Editing the page

- **Change the download URL** — search for `1WiiG7oKtfbUybBLH0OxqdwN5yZuUijJY`
  in `index.html` and replace both hits with the new Google Drive
  file ID (or a different URL entirely).
- **Change the GitHub repo URL** — search for `ceasis/qnsub-screenrecorder`
  and replace with your actual user/repo. There are ~6 occurrences
  in the nav, hero, feature cards, and footer.
- **Add a feature card** — duplicate any `<div class="feature">` block
  in the `#features` section and swap the icon SVG, title, and
  description.
- **Change the accent colour** — edit the `--accent`, `--accent-bright`,
  and `--accent-dark` CSS custom properties at the top of the
  `<style>` block.
- **Screenshots** — none currently. Drop PNGs into `docs/img/` and
  reference them with `<img src="img/screenshot.png">`. The folder
  is served from the same Pages deployment.

## Why `docs/` and not `gh-pages`?

Both work. `docs/` is simpler because:
- No separate branch to maintain.
- Committing site changes next to code changes keeps both reviewable
  in one PR.
- No CI workflow needed — GitHub serves the folder as-is.

If you outgrow this (want a real static site generator, asset
pipeline, tests for the landing page itself), switch to a
`gh-pages` branch deployed by a GitHub Action. Until then, a single
HTML file in `docs/` is the right amount of tool.

## Local preview

Just open the file in a browser:

```
file:///absolute/path/to/repo/docs/index.html
```

Or with any static server, e.g. `npx http-server docs`. There's no
build step, no CSS preprocessor, no template engine — edit and
reload.
