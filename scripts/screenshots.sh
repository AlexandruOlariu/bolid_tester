#!/usr/bin/env bash
# Store screenshots (plan 30, store/README.md): run .maestro/screenshots.yaml on a connected Android
# emulator for each listing language, with a clean status bar, then resize the results to the store
# size and check them.
#
#   scripts/screenshots.sh          # en, then ro
#   scripts/screenshots.sh ro       # one language
#
# Needs: Maestro (https://maestro.mobile.dev) and adb on PATH, one emulator running a phone image
# (Pixel 7-class, 1080 × 2400) with a release or preview build of the app installed
# (docs/testing.md → End-to-end). No car, no adapter: the flow uses the simulator.
# iPhone: run the same flow on an iPhone 15 Pro Max simulator with OUT=store/screenshots/ios/6.7/<lang>
# (an EAS simulator build, plan 09); the demo-mode block below is Android-only. The script sticks to
# bash 3.2 features (macOS /bin/bash) so it also runs on a stock Mac.
set -euo pipefail

cd "$(dirname "$0")/.."
if [ $# -eq 0 ]; then langs=(en ro); else langs=("$@"); fi

command -v maestro >/dev/null || { echo "screenshots: maestro is not on PATH (https://maestro.mobile.dev)" >&2; exit 1; }
command -v adb >/dev/null || { echo "screenshots: adb is not on PATH (Android SDK platform-tools)" >&2; exit 1; }
[ "$(adb devices | grep -c 'device$')" -eq 1 ] || { echo "screenshots: connect exactly one emulator or device" >&2; exit 1; }

demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

# Status bar demo mode: 12:00, full battery, full Wi-Fi, no mobile data, no notification icons.
adb shell settings put global sysui_demo_allowed 1
demo enter
demo clock -e hhmm 1200
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4
demo network -e mobile hide
demo notifications -e visible false
trap 'demo exit' EXIT

for lang in "${langs[@]}"; do
  out="store/screenshots/android/phone/$lang"
  mkdir -p "$out"
  # The flow's labels in this language (scripts/screenshot-labels.mjs). Read into a variable first
  # so a failing node aborts under `set -e`, then line by line: no `mapfile`, which needs bash 4 —
  # macOS ships bash 3.2 as /bin/bash, and the iOS run happens on a Mac.
  labels="$(node scripts/screenshot-labels.mjs "$lang")"
  args=(-e "OUT=$out")
  while IFS= read -r kv; do
    if [ -n "$kv" ]; then args+=(-e "$kv"); fi
  done <<< "$labels"
  echo "screenshots: $lang -> $out"
  maestro test "${args[@]}" .maestro/screenshots.yaml
done

# Resize to 1080 × 2400 (and any other set size), regenerate the graphics, check everything.
node scripts/store-assets.mjs --generate
node scripts/store-assets.mjs --release
