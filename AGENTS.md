# AGENTS.md

## Repository State
- This repository contains a Manifest V3 Chrome extension for Roblox Home and game pages on `https://www.roblox.com`.
- `manifest.json` injects `content.css` and `content.js` at `document_start` on Home.
- Game pages load `server-browser.css` and `server-browser.js`; `roblox-page-bridge.js` runs in the page's main world so direct joins use Roblox's official `GameLauncher`.
- Game-page match patterns cover both `/games/*` and locale-prefixed paths such as `/es/games/*`; `https://www.roblox.com/*` is also a host permission because dynamic main-world injection uses `chrome.scripting`.
- `background.js` owns Roblox API orchestration, bounded cursor pagination, retry/backoff, and the expiring region/datacenter cache. Region POSTs execute in the Roblox tab's main world so their origin/referrer match the website request; `GameJoinRegion` is extracted from the JSON stored in `joinScript.SessionId` when Roblox does not return it as a direct property. The public IP from `joinScript.UdmuxEndpoints` is geolocated through `https://ipwho.is`, with request deduplication, rate-limit handling, and separate expiring IP and `DataCenterId` location caches.
- `network-rules.json` contains a single scoped MV3 `declarativeNetRequest` rule that sets Roblox's required `User-Agent` only for `join-game-instance` requests initiated by `www.roblox.com`.
- `content.js` customizes Roblox Home by removing selected navigation entries, removing the Friends `See All` and `Add Friends` tile, moving `Continue` above `Recommended For You`, removing `Standout Games`, and merging duplicate `Recommended For You` sections.
- `content.css` reduces FOUC, preserves the intended visual order, limits `Continue` to 40 visible games, and changes `Continue` from a carousel to a wrapping grid.
- `server-browser.js` detects game PlaceIds, analyzes up to a configurable public-server page limit with configurable worker concurrency, groups results by geolocated administrative region and country, and renders a region filter with live progress. Approximate locations come from the public UDMUX endpoint IP; compact labels prefer the administrative region over the city (for example, `São Paulo, Brasil`). Live result rendering is throttled to once per second so large analyses do not continuously rebuild the full UI.
- `server-browser.css` contains all Server Browser styling and follows Roblox's light/dark themes.
- Do not assume a package manager, build system, test runner, or bundled entrypoint until project files are added.

## Design Prototypes
- `ideas front/` is only a container for static design ideas that may guide future extension changes. Files in this directory are references, are not production extension entrypoints, and must not be treated as implemented functionality.
- `ideas front/adaptable-home.html` is the selected design reference for the future replacement of Roblox `/home`; the other files in `ideas front/` remain alternative or historical concepts.
- `ideas front/adaptable-home.html` is currently a static HTML/CSS prototype with placeholder data and no application logic. Its future implementation is intended to obtain its dynamic Roblox data exclusively from public Roblox APIs.

## Verification
- Syntax checks:
  - `node --check content.js`
  - `node --check background.js`
  - `node --check server-browser.js`
  - `node --check roblox-page-bridge.js`
- Manifest parse check: `node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"`.
- Network rules parse check: `node -e "JSON.parse(require('fs').readFileSync('network-rules.json', 'utf8'))"`.
- Manual verification: reload the unpacked extension in Chrome from the repository root, then refresh `https://www.roblox.com/home`.
- Expected Home order after load: `Friends -> Continue -> Recommended For You`, followed by remaining sections such as `Favorites`.
- Expected `Continue` behavior: wrapping grid with only the first 40 games visible.
- Game-page verification: open `https://www.roblox.com/games/{placeId}/...`, confirm Server Browser appears above Roblox's server list, live progress advances, servers from different `DataCenterId` values in the same geolocated administrative region render together under a compact region/country label, cards show only players and FPS, filters reorder results, and `Entrar` opens the selected JobId.
- The Server Browser analyzes at most 20 public-server pages (up to 2,000 servers at 100 per page) and uses 20 concurrent join-game workers; edit `SERVER_BROWSER_CONFIG` in `server-browser.js` to tune both limits.
- Region checks run at a maximum of 8 requests per second globally, including retries. A Roblox `429` automatically reduces the rate by half, down to a minimum of 5 requests per second, observes a bounded `Retry-After` cooldown, and recovers gradually up to 8; edit the `region*` values in `SERVER_BROWSER_CONFIG` in `background.js` to tune this behavior.
- Region/datacenter cache entries expire after 5 minutes; edit `SERVER_BROWSER_CONFIG.cacheTtlMs` in `background.js` to tune the TTL.
- IP geolocation checks are limited to 10 requests per second, deduplicated by address and `DataCenterId`, and cached for 30 days; edit the `geolocation*` values in `SERVER_BROWSER_CONFIG` in `background.js` to tune these limits. Temporary lookup failures are negatively cached for 10 minutes, and provider `429` responses pause further lookups according to `Retry-After`.
- There is still no repo-local package manager, build, lint, typecheck, test runner, or CI config.
- After adding executable config, update this file with the exact commands from manifests, task runners, or CI.
