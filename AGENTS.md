## Imported Claude Cowork project instructions

## Package manager
- This project uses **pnpm only** (`pnpm install`, `pnpm add`, `pnpm dev`). Never run `npm install` or `yarn` here: it copies mismatched package versions (e.g. @nuxt/nitro-server, unhead, @vue/*) into node_modules on top of pnpm's symlinks and breaks Nuxt SSR payload hydration (useState / color-mode stop reacting, light mode "doesn't work").
- If node_modules ever gets mixed up, fix it with: `rm -rf node_modules .nuxt && pnpm install`.
- Do not add "payload-fix" style plugins or disable `experimental.appManifest` to silence hydration errors — those errors mean the install is broken; reinstall instead.

## App version (shown in the sidebar as "Role (V2.1.1)")
- The version lives in `version.json` at the project root. Don't edit it by hand and don't move it into package.json.
- `.githooks/pre-commit` runs `scripts/bump-version.mjs`, which bumps it once per push: the first commit after a push goes up by one step (2.1.1 → 2.1.2 … 2.1.9 → 2.2.0 … 2.9.9 → 3.0.0); later commits before the next push keep the same version.
- The hook is enabled by `pnpm install` (the `prepare` script sets `git config core.hooksPath .githooks`). Never commit with `--no-verify`.
