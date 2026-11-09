# Web build (Web Bluetooth)

The app also runs in a browser as a static site ([plan 28](./plans/28-web-bluetooth-pwa.md)). It is
the zero-install way to try the engine and the simulator, and in **Chrome or Edge** it connects to a
real **Bluetooth LE** ELM327 through **Web Bluetooth**. The same code runs on the phone and on the
web; the few native-only pieces either have a web replacement or say plainly that they are not
available yet — nothing crashes.

**Try it:** `https://alexandruolariu.github.io/bolid_tester/` (live once the owner enables GitHub
Pages — see [Deployment](#deployment)).

## Browser support

| Browser                                          | Simulator | Real adapter (Web Bluetooth)                                                          |
| ------------------------------------------------ | --------- | ------------------------------------------------------------------------------------- |
| Chrome / Edge — Windows, macOS, Linux            | ✓         | ✓ Bluetooth LE adapters                                                               |
| Chrome — Android                                 | ✓         | ✓ Bluetooth LE adapters                                                               |
| Safari (macOS, iOS), any iPhone browser, Firefox | ✓         | ✗ — the Connect screen shows "not supported in this browser" and offers the simulator |

Rules the browser enforces:

- **HTTPS only** (or `http://localhost` while developing). GitHub Pages serves HTTPS.
- **A tap opens the device list.** `navigator.bluetooth.requestDevice()` only works inside a user
  gesture, so the Connect screen has a single **Choose adapter & connect** button whose press
  handler opens the chooser first and connects to the pick. Auto-reconnect reuses the picked device
  (`gatt.connect()` needs no gesture), so a drop does not ask again.
- **Only listed services can be opened.** The chooser lists every device (`acceptAllDevices`, since
  ELM327 clones name themselves inconsistently) and requests the ELM327 BLE services in
  `src/shared/transports/common/obdServiceUuids.ts` as `optionalServices` — the four common 16-bit
  ones (FFF0, FFE0, FFE5, 18F0) plus the vendor 128-bit service widely reported for the Vgate iCar
  Pro BLE (`e7810a71-…`, unconfirmed until the on-car session). Chrome hides every other service,
  so unlike the phone app, discovery on the web only sees these: an adapter that connects from the
  phone but fails in the browser with "does not offer an OBD2 adapter service" is on an unlisted
  service UUID, and that list needs it added.
- **No MTU API.** Writes go out in 20-byte chunks (the BLE 4.0 minimum payload); the diagnostics
  panel reports MTU 23 / payload 20.
- **One GATT operation at a time.** Chrome rejects a write while another is pending, so the
  transport queues its writes (ble-plx does this itself on the phone).
- **Classic Bluetooth (SPP) and Wi-Fi adapters are not reachable** from a browser (no RFCOMM, no
  raw TCP sockets). Settings offers only **Real adapter (Bluetooth)** and **Simulator** on the web;
  a Wi-Fi or Classic Bluetooth source restored from a phone backup falls back to Bluetooth LE with
  a one-time notice.

## Capability matrix

| Capability                                                                                                                                       | Phone                                  | Web                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Bluetooth LE adapter                                                                                                                             | `BleTransport` (react-native-ble-plx)  | `WebBluetoothTransport` (`src/shared/transports/web-ble/`); `getBleManager()` throws on web and is never called there   |
| Wi-Fi / Classic Bluetooth adapters                                                                                                               | ✓ (Classic: Android only)              | ✗ — hidden in Settings and on the Connect screen                                                                        |
| Simulator                                                                                                                                        | ✓                                      | ✓ — the primary web experience                                                                                          |
| Bus sniffer (`ATMA`)                                                                                                                             | ✓                                      | ✓ over Web Bluetooth (notifications stream)                                                                             |
| Persisted settings, history, garage, …                                                                                                           | JSON file per store (expo-file-system) | `localStorage`, same `bolid.<area>` keys (`persistStorage.ts`); about 5 MB per site — a full quota is logged, not fatal |
| Exports: error log, DTC report, auto-scan report, adapter health, chart CSV, measuring log, car backup, garage JSON, bus capture, replay fixture | File + share sheet                     | **Downloaded** by the browser (`saveTextFile` in `src/shared/lib/saveFile.ts`)                                          |
| Vehicle report (HTML / PDF / Markdown), history re-share, trip CSV share, full backup / restore, profile & label-pack import / export            | ✓                                      | "Not available on web yet" toast — they need a real file system; the toast is the only message (no native follow-up)    |
| Trips                                                                                                                                            | CSV per trip on disk                   | Trip summaries persist; the per-sample CSV is not kept (no file system), so a trip's detail track is empty              |
| AI API key                                                                                                                                       | OS keystore (expo-secure-store)        | Memory only, until the tab closes — Settings says so under the key field                                                |
| Notifications, haptics                                                                                                                           | ✓                                      | No-ops (tolerant wrappers)                                                                                              |
| Location (trip GPS)                                                                                                                              | ✓                                      | Browser geolocation through expo-location's web module (the browser asks for permission)                                |
| OTA updates                                                                                                                                      | expo-updates                           | Reports "unavailable"; a reload fetches the latest deploy                                                               |

**Alerts.** react-native-web's `Alert.alert` is an empty stub, so a confirm (Clear fault codes,
Reset all data, Delete car…), a choice (the error log's Markdown / JSON export) or a notice routed
through it would silently do nothing in the browser. Every alert therefore goes through `appAlert()`
(`src/shared/ui/appAlert.ts`): the system alert on the phone, an in-app dialog (`AlertDialog`,
mounted once in the root layout; a tap outside or Escape = Cancel) on the web. ESLint
(`no-restricted-properties`) rejects a direct `Alert.alert`.

How the app knows it is in a browser: UI code uses `Platform.OS === 'web'`; shared services that
also run in the Node test project use `isWebRuntime()` (`src/shared/lib/webRuntime.ts`, "is there a
DOM"), so they stay free of React Native imports.

## Run it locally

```bash
npx expo start --web          # dev server; the app is served under /bolid_tester
```

Web Bluetooth works on `localhost` too, so a laptop with Bluetooth can connect to a real adapter from
the dev server.

## Build

```bash
npx expo export --platform web --output-dir web-build
```

Never export into `dist/` — it is gitignored because it holds local APKs. `web-build/` is gitignored
too. The export is a single-page app (`app.json` → `web.output: "single"`): one `index.html` and
expo-router routes in the browser. A static host must still answer a deep URL such as
`/bolid_tester/settings` with that page — GitHub Pages serves a missing path's `404.html`, so the
workflow copies `index.html` to `404.html` (the router then reads the real URL; the HTTP status is
404, which the browser ignores). Every URL is prefixed with
`/bolid_tester` (`experiments.baseUrl`, for GitHub project pages). To open the export locally, serve
the folder **under that prefix**, e.g.:

```bash
mkdir -p site && cp -r web-build site/bolid_tester && npx serve site   # then /bolid_tester/
```

The local export on 2026-11-09 bundled 3,535 modules in about 6 s (warm cache); the main bundle is
about 4.7 MB. Served under `/bolid_tester/` and driven in headless Chrome, it rendered the Connect
screen (**Choose adapter & connect**), read a `bolid.settings` value seeded into `localStorage`
back after a reload (the simulator source), and **Connect to simulator** reached _Connected_ and
opened the Vehicle tab with no console errors.

## Deployment

`.github/workflows/web.yml` exports the site and deploys it to GitHub Pages on every push to `main`
and on demand (**Actions → Web (GitHub Pages) → Run workflow**): checkout → Node 24 →
`npm install --legacy-peer-deps --ignore-scripts` → `npx expo export --platform web --output-dir
web-build` → `touch web-build/.nojekyll` (Jekyll would drop the `_expo/` folder) →
`actions/upload-pages-artifact@v3` → `actions/deploy-pages@v4` in a `deploy` job
(`pages: write`, `id-token: write`, environment `github-pages`).

**One-time owner setup:** repository **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The site is then at `https://alexandruolariu.github.io/bolid_tester/`.

## Out of scope (follow-ups)

- Offline install as a PWA (service worker + manifest).
- Web Serial for USB adapters.
- iOS — no Web Bluetooth in any iOS browser.
- Writing the remaining file exports (vehicle report, backup, trips) as downloads, and file import
  through `<input type="file">`.

## Still to verify on hardware

From the plan's deferred section: connect the Vgate from Chrome on Android and from a laptop and
record the chooser name, the service UUID picked and the latency grade in the adapter docs (plan
29); confirm whether the Vgate needs the 20-byte chunking on the web path or accepts larger writes.
