# Feature: extended-pids (experimental, flagged)

Profile-driven **manufacturer-specific** reads via **Mode 22** (UDS `readDataByIdentifier`). **VAG is
the first example.** This is opt-in and clearly marked experimental.

> ⚠️ **Experimental.** Manufacturer DIDs are **not standardized**. The example DIDs shipped in the
> profiles are **illustrative** and must be **confirmed on the real car** before the values are
> trusted. The simulator returns canned values so the feature can be exercised end-to-end without
> hardware.

## Applicability
- Only **CAN/UDS-capable** cars can answer Mode 22. In our examples that means the **Golf Plus 2009**.
- The **Passat B5.5** and older **Punto** are **K-line/KWP2000** — Mode 22 does **not** apply; their
  profiles declare no extended PIDs. (Genuine VAG extra data there needs VCDS-style measuring blocks,
  which a generic ELM327 cannot read.)

## UI
- **ExtendedPidsScreen** — only shown when the active profile declares `extendedPids` **and** the link
  is CAN. Each row: name, value, an "experimental / unverified" badge, and the raw DID + response.

## hooks
- `useExtendedPids()` — reads the profile's `extendedPids`, issues the Mode 22 requests, exposes
  values + raw frames.

## api (service layer)
- `extendedPidService` — optionally sets a CAN RX filter (`ATCRA`), sends `22 <DID>`, parses the `62`
  response per the profile's decoder.

## model
- `extendedStore` (Zustand): `values`, `rawFrames`, `enabled`.

## Behavior
- Hidden entirely unless the profile opts in and the protocol is CAN.
- Every value is labeled experimental; raw frames are always shown for debugging/confirmation.

## Acceptance
- For the Golf simulator, the seeded experimental DID returns a plausible value with the
  "unverified" badge.
- Never offered for the Passat/Punto profiles.
