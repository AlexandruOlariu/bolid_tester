# Contribute fault-code (DTC) texts

The DTC database (`src/shared/obd-core/obd/dtcDatabase/`, [plan 05](../plans/05-dtc-database.md),
[fault-codes → DTC database](../features/fault-codes.md#dtc-database)) gives every code the app
shows a description, a system and a severity hint. Codes without an entry fall back to the range
description ("Powertrain — Fuel & air metering fault (P0199)"), so **a missing code is better than
a guessed one**. Ground rules and licensing: [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Which file

| Codes                                                            | File                                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| P0000–P02FF / P0300–P05FF / P0600–P09FF / P0A00–P0AFF            | `generic/p0-part1.ts` … `generic/p0-part4.ts`       |
| P2000–P24FF / P2500–P2FFF                                        | `generic/p2-part1.ts` / `generic/p2-part2.ts`       |
| P3400–P34FF (SAE cylinder deactivation block)                    | `generic/p3.ts`                                     |
| B0xxx / C0xxx / U0xxx                                            | `generic/b0.ts` / `generic/c0.ts` / `generic/u0.ts` |
| VAG manufacturer codes (P1xxx, SAE form)                         | `manufacturer/vag-p1.ts`                            |
| VAG native 5-digit fault numbers (KWP, the VCDS "00532" numbers) | `manufacturer/vag.ts` → `VAG_DTC_TEXTS`             |
| Fiat / FGA manufacturer codes (P1xxx)                            | `manufacturer/fiat.ts`                              |

`p0.ts` and `p2.ts` only compose their parts; never add codes there. A new make gets a new
`manufacturer/<make>.ts` (talk to a maintainer first: it also needs a `DtcMake` and a lookup).

## Rules

- **One code per line**, `P0101: 'Mass or Volume Air Flow Sensor A Circuit Range/Performance',`.
  Keys are upper-case 5-character SAE codes (`/^[PCBU][0-9A-F]{4}$/`); `VAG_DTC_TEXTS` keys are
  five digits.
- **Canonical wording**: short, title case, the standard's terms ("Circuit Low", "Range/
  Performance", "Bank 1 Sensor 2"). Metric units if a unit appears.
- **No duplicates**, within a file or across files. A manufacturer meaning never overrides a
  generic code.
- **Cite the source.** Every file header carries a `License:` line. Texts you wrote yourself from
  the SAE J2012 / ISO 15031-6 definitions or the manufacturer's published meaning are MIT
  (`License: MIT, authored for bolid-tester …`, already there). If you used a list, it must be MIT,
  BSD or public domain: add its URL and licence to the header.
- **Never** copy from python-OBD's `codes.py` (GPL-2), pyOBD or any other GPL list, and never from
  VCDS label files. The validator fails a file that names one as its `Source:` / `License:` or
  carries it in its data.
- Keep each file under 1 800 lines; the whole database stays under 350 KB of source.

## Check

```bash
npm test -- dtcDatabase
npm run validate:contrib
```

`validate:contrib` reports a code defined in two files with both file names, a malformed key, an
empty description, a key listed twice in one file, and a header without `License:`.
