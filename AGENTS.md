# AGENTS.md

## Repository State
- This repository contains a Manifest V3 Chrome extension for `https://www.roblox.com/home`.
- `manifest.json` injects `content.css` and `content.js` at `document_start`.
- `content.js` customizes Roblox Home by removing selected navigation entries, removing the Friends `See All` and `Add Friends` tile, moving `Continue` above `Recommended For You`, removing `Standout Games`, and merging duplicate `Recommended For You` sections.
- `content.css` reduces FOUC, preserves the intended visual order, limits `Continue` to 40 visible games, and changes `Continue` from a carousel to a wrapping grid.
- Do not assume a package manager, build system, test runner, or bundled entrypoint until project files are added.

## Verification
- Syntax check: `node --check content.js`.
- Manual verification: reload the unpacked extension in Chrome from the repository root, then refresh `https://www.roblox.com/home`.
- Expected Home order after load: `Friends -> Continue -> Recommended For You`, followed by remaining sections such as `Favorites`.
- Expected `Continue` behavior: wrapping grid with only the first 40 games visible.
- There is still no repo-local package manager, build, lint, typecheck, test runner, or CI config.
- After adding executable config, update this file with the exact commands from manifests, task runners, or CI.
