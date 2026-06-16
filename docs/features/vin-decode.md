# Feature: vin-decode

Decode the **VIN** (read over Mode 09 PID 02, or typed in) into its meaning: **WMI** manufacturer,
**region & country** of build, **model year**, plant code and serial, plus a **check-digit** result.
Fully **offline** — no network, no VIN API.

> Honest scope: the **model-year (char 10)** and **check-digit (char 9)** conventions are
> **North-American** (FMVSS 565). Many rest-of-world manufacturers (including VAG and Fiat) don't
> encode a year in char 10 or carry a valid check digit, so each result is flagged: the year is shown
> as "unknown" when char 10 isn't a valid code, and the check digit as "not applicable" outside North
> America. (An optional online decode — e.g. NHTSA vPIC — could enrich make/model/engine later.)

## What it decodes
- **WMI** (chars 1–3) → manufacturer, from a focused offline dictionary (full VAG coverage + common
  marques); unknown WMIs fall back to a country-derived label.
- **Region & country** (ISO 3780) from chars 1–2.
- **Model year** (char 10) with the char-7 rule to resolve the 30-year cycle (numeric ⇒ 1980–2009,
  alpha ⇒ 2010–2039); `null` when char 10 isn't a valid year code.
- **Plant code** (char 11) and **serial** (chars 12–17), shown raw.
- **Check digit** (char 9): computed vs. actual, with an `applicable` flag (North-American VINs only).

## UI
- **VinDecodeScreen** — shows the connected car's VIN decoded into a labelled card, plus a text field
  to paste/scan any VIN and decode it. A malformed VIN (wrong length, or containing I/O/Q) is flagged
  clearly. Linked from the **Vehicle info** screen and from **More**.

## hooks
- `useVinDecode()` — takes the session VIN (or a manual entry), returns `decodeVin(vin)` plus a
  `validFormat` flag and a setter for the manual field.

## api (core)
- Pure decoding in [`obd-core/obd/vinDecode`](../architecture.md) — `decodeVin(raw)` →
  `DecodedVin`, with `decodeModelYear`, `computeCheckDigit`, `vinCheckDigit`, `decodeManufacturer`.
  No I/O; unit-tested against the three example VINs + a North-American check-digit case.

## model
- No store needed — the decode is derived from the session VIN or a local component state for the
  manual field.

## Behavior
- Entirely hardware-free (string math). In the **simulator** the per-car sample VINs decode correctly
  (e.g. the Golf VIN → Volkswagen / Germany / 2009).

## Acceptance
- `WVWZZZ1KZ9W903398` → Volkswagen, Germany, 2009; check digit not applicable.
- `1HGCM82633A004352` → Honda, United States, 2003; check digit valid.
- A VIN containing I/O/Q or of the wrong length is reported as malformed.
