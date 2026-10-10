# Offshore Studio desktop app

The desktop app bundles the three tools (3-D Studio, load calculator, array
study) with everything they need. It works offline, never contacts a server,
and stores nothing outside the files you save yourself.

## Download

Installers are built by GitHub Actions on each operating system, and each one
is tested there before it is kept:

- **Latest build:** open the
  [Desktop app workflow](https://github.com/VENTIXG/first-app/actions/workflows/desktop.yml)
  → the most recent green run → **Artifacts**. Download the
  one for your system and unzip it (GitHub wraps artifacts in a zip). You need
  to be signed in to GitHub, and artifacts are kept for 30 days.
- **Releases:** when a version tag (for example `v0.6.0`) is pushed, the same
  installers are attached to a draft release, which can then be published
  under **Releases**.

| System | File | Notes |
|---|---|---|
| Windows 10/11 (64-bit) | `Offshore-Studio-Setup-<version>-x64.exe` | installer (per user, no administrator rights needed) |
| | `Offshore-Studio-Portable-<version>-x64.exe` | runs without installing (slower to start) |
| macOS 11+ Apple Silicon | `Offshore-Studio-<version>-mac-arm64.dmg` | M1/M2/M3/M4 Macs |
| macOS 11+ Intel | `Offshore-Studio-<version>-mac-x64.dmg` | |
| Linux (Ubuntu/Debian) | `Offshore-Studio-<version>-linux-amd64.deb` | recommended on Ubuntu 24.04 |
| Linux (other) | `Offshore-Studio-<version>-linux-x86_64.AppImage` | single file, no installation |

## What is tested

For every build, the desktop test suite (`tests/electron`, 7 tests) runs against
the packaged app on GitHub-hosted runners: Windows (x64), macOS (Apple
Silicon) and Ubuntu (x64, virtual display). It starts the real executable and
checks the home page, the calculator (worker computation, Plotly chart, 3-D view,
PDF and CSV saved to disk), the studio (Rhino import through WebAssembly), the
array study, the menus and the unsaved-changes prompt, persistence of scenarios
and theme across a restart, and that links leave the app.

Not covered by automated tests: the installers' own setup screens (the tests
run the unpacked app the installer contains), the Intel macOS build (built on an
Apple Silicon runner, not run), and real graphics cards (the runners render
WebGL in software).

## Installing: the "unknown publisher" warnings

The builds are **not code-signed**: signing needs paid certificates from
Microsoft and Apple. The operating systems therefore warn the first time:

- **Windows** — "Windows protected your PC" (SmartScreen): click **More info**
  → **Run anyway**.
- **macOS** — open the `.dmg` and drag *Offshore Studio* to *Applications*. The
  first time, right-click (or Control-click) the app → **Open** → **Open**. If
  macOS says the app "is damaged", it was quarantined by the browser download;
  run once in Terminal:
  `xattr -dr com.apple.quarantine "/Applications/Offshore Studio.app"`
- **Linux** — `.deb`: `sudo apt install ./Offshore-Studio-<version>-linux-amd64.deb`,
  then start it from the applications menu. AppImage: `chmod +x` the file and
  run it. On Ubuntu 22.04+ AppImages need `libfuse2` (`sudo apt install libfuse2t64`
  on 24.04). If an AppImage closes immediately with a sandbox message (Ubuntu
  24.04 restricts it), use the `.deb`, or start the AppImage with `--no-sandbox`.

## Using it

The app opens on the home page. Switch tools with the links at the top of
each page or the **Go** menu (Ctrl/Cmd+1 Studio, +2 calculator, +3 array study,
+0 home). Exports (CSV, JSON, PDF) and studio projects open a normal *Save*
dialog; Rhino files and projects are opened with the usual file dialogs.
Leaving the studio with unsaved changes asks first.

Without a graphics card that the browser engine can use (virtual machines,
remote desktops, some old drivers), the 3-D views fall back to software
rendering: they work, but the frame rate is reduced automatically so that
the rest of the window stays responsive.

## Security design

- The pages are the same as the web version, served from a private
  `app://local` origin; they have no access to Node.js or the file system
  (context isolation and the Chromium sandbox are on).
- Only the app's own folders are served; every other request is refused, so
  the app cannot reach the network.
- Every page has a Content-Security-Policy. The Rhino import worker is the only
  code allowed to generate functions (`unsafe-eval`), because the rhino3dm
  bindings need it; it runs in an isolated worker that is discarded after each
  import.
- Links to websites open in your normal browser, never inside the app.
- Camera, microphone, location and similar permissions are always refused.

## Building it yourself

```bash
npm ci
npm run app              # build the studio and start the app from source
npm run dist             # installers for the current system → release/
xvfb-run -a npm run test:app                                        # Linux, from source
APP_EXECUTABLE=release/linux-unpacked/offshore-studio xvfb-run -a npm run test:app   # packaged app
```

On Windows and macOS run `npm run test:app` without `xvfb-run`. When running
as root (containers), Electron needs `--no-sandbox`; the test launcher adds it
on Linux.

## Known limitations

- Not code-signed or notarised (see above); no automatic updates. Install a
  newer version over the old one.
- The calculator's saved scenarios live in the app's own storage, separate from
  any browser where you used the web version.
- Build tooling: `npm audit` reports advisories in electron-builder's download
  helpers (`sprintf-js`, via `global-agent`) and in Tailwind 3's file globbing.
  They affect the build machine's tooling only; nothing from them is shipped.
