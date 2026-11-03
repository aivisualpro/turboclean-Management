## Imported Claude Cowork project instructions

## Package manager
- This project uses **pnpm only** (`pnpm install`, `pnpm add`, `pnpm dev`). Never run `npm install` or `yarn` here: it copies mismatched package versions (e.g. @nuxt/nitro-server, unhead, @vue/*) into node_modules on top of pnpm's symlinks and breaks Nuxt SSR payload hydration (useState / color-mode stop reacting, light mode "doesn't work").
- If node_modules ever gets mixed up, fix it with: `rm -rf node_modules .nuxt && pnpm install`.
- Do not add "payload-fix" style plugins or disable `experimental.appManifest` to silence hydration errors — those errors mean the install is broken; reinstall instead.
