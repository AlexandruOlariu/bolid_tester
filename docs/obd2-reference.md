# OBD2 / ELM327 Reference

This is the technical reference the code in `src/shared/obd-core` implements. It is intentionally
concise; it documents exactly what the app uses.

## Transport protocols (ELM327 `ATSPn`)

| n | Protocol | Notes |
|---|----------|-------|
| 0 | Auto | Let the ELM327 detect. **Default we use.** |
| 1 | SAE J1850 PWM | Ford (not in our cars). |
| 2 | SAE J1850 VPW | GM (not in our cars). |
| 3 | ISO 9141-2 | K-line, 5-baud init. Older EU cars. |
| 4 | ISO 14230-4 KWP2000, 5-baud init | K-line. |
| 5 | ISO 14230-4 KWP2000, fast init | K-line. **Common on VW B5.5-era.** |
| 6 | ISO 15765-4 CAN, 11-bit, 500 kbps | **Most 2008+ cars (e.g. Golf Plus 2009).** |
| 7 | ISO 15765-4 CAN, 29-bit, 500 kbps | |
| 8 | ISO 15765-4 CAN, 11-bit, 250 kbps | |
| 9 | ISO 15765-4 CAN, 29-bit, 250 kbps | |
| A | SAE J1939 (CAN) | Heavy vehicles. |

We default to **auto (`ATSP0`)**; the negotiated protocol is read back with `ATDPN` and stored on the
session and (when it matches) compared to the vehicle profile's `expectedProtocol`.

## ELM327 AT commands we use

| Command | Effect |
|---------|--------|
| `ATZ` | Reset (returns the version banner). |
| `ATI` | Print version id. |
| `ATE0` | Echo off (we parse cleaner output). |
| `ATL0` | Linefeeds off. |
| `ATS0` | Spaces off (compact hex). |
| `ATH1` / `ATH0` | Headers on / off. |
| `ATSP0` | Set protocol = auto. |
| `ATSPn` | Force protocol n (used to retry a profile's expected protocol). |
| `ATDP` / `ATDPN` | Describe current protocol (name / number). |
| `ATAT1` | Adaptive timing on. |
| `ATST hh` | Set response timeout (×4 ms). |
| `ATRV` | Read battery voltage (e.g. `12.3V`). |
| `ATCRA hhh` | Set CAN RX filter (for extended/manufacturer PIDs on a specific ECU). |
| `ATCAF1/0` | CAN auto-formatting on/off. |

Commands are terminated with `\r`. A complete response ends with the prompt character `>`.

## OBD2 modes (services)

| Mode | Meaning | Response prefix |
|------|---------|-----------------|
| 01 | Current live data | `41` |
| 02 | Freeze-frame data | `42` |
| 03 | Stored DTCs | `43` |
| 04 | Clear DTCs / MIL | `44` |
| 06 | On-board monitor test results | `46` |
| 07 | Pending DTCs | `47` |
| 09 | Vehicle info (VIN, etc.) | `49` |
| 0A | Permanent DTCs | `4A` |
| 22 | Manufacturer-specific data (UDS `readDataByIdentifier`) | `62` |

Request format: mode + PID as hex, e.g. `010C` (Mode 01, PID 0C = RPM). The reply echoes mode+0x40,
then the PID, then the data bytes, e.g. `41 0C 1A F8`.

## Mode 01 PIDs we decode

`A`, `B`, `C`, `D` are the successive data bytes (decimal).

| PID | Name | Formula | Unit |
|-----|------|---------|------|
| 0100/0120/0140/0160 | Supported PIDs (bitmap) | bit set ⇒ supported | — |
| 0101 | Monitor status since DTCs cleared | A bit7 = MIL on; A&0x7F = DTC count; B/C/D = readiness | — |
| 0103 | Fuel system status | bitmask | — |
| 0104 | Calculated engine load | A·100/255 | % |
| 0105 | Engine coolant temp | A−40 | °C |
| 0106 | Short-term fuel trim (B1) | (A−128)·100/128 | % |
| 0107 | Long-term fuel trim (B1) | (A−128)·100/128 | % |
| 010A | Fuel pressure | A·3 | kPa |
| 010B | Intake manifold abs. pressure | A | kPa |
| 010C | Engine RPM | (256A+B)/4 | rpm |
| 010D | Vehicle speed | A | km/h |
| 010E | Timing advance | A/2−64 | ° |
| 010F | Intake air temp | A−40 | °C |
| 0110 | MAF air flow | (256A+B)/100 | g/s |
| 0111 | Throttle position | A·100/255 | % |
| 011F | Run time since engine start | 256A+B | s |
| 0121 | Distance with MIL on | 256A+B | km |
| 012F | Fuel tank level | A·100/255 | % |
| 0133 | Barometric pressure | A | kPa |
| 0142 | Control module voltage | (256A+B)/1000 | V |
| 0146 | Ambient air temp | A−40 | °C |
| 015C | Engine oil temp | A−40 | °C |
| 015E | Engine fuel rate | (256A+B)/20 | L/h |

Diesels typically expose fewer PIDs (often no MAF/lambda the same way; coolant, RPM, speed, IAT,
MAP, load, run-time, voltage are usually present). The app **only** shows PIDs the ECU reports as
supported (from the bitmap) — see [`features/live-data.md`](./features/live-data.md).

## DTC encoding

Each DTC is **2 bytes**. The top 2 bits of the first byte select the letter; the next 2 bits are the
first digit; the remaining nibble is the second digit; the second byte gives the 3rd and 4th digits.

```
First byte bits 7..6 → letter:  00=P (powertrain) 01=C (chassis) 10=B (body) 11=U (network)
First byte bits 5..4 → digit 1 (0–3)
First byte bits 3..0 → digit 2 (hex)
Second byte         → digits 3 & 4 (two hex nibbles)
```

Example: bytes `01 33` → `00` ⇒ `P`, `00` ⇒ `0`, `1` ⇒ `1`, `33` ⇒ `33` → **`P0133`**.

- **Mode 03** response `43` is followed by DTC byte-pairs (`00 00` padding means "no code").
- **Mode 07** (`47`) = pending; **Mode 0A** (`4A`) = permanent.
- **Mode 04** clears DTCs and turns off the MIL; success reply is `44`.

A small built-in dictionary maps the most common generic codes (e.g. `P0101`, `P0299`, `P0401`) to
text; unknown codes are shown with the standard "generic powertrain" description by range.

## VIN (Mode 09 PID 02)

Request `0902`. On CAN the response is a multi-frame (ISO-TP) message; on K-line it arrives as
several lines. The app strips the `49 02` headers and a leading frame/count byte, concatenates the
remaining bytes, and decodes ASCII to the 17-character VIN.

## Error/notice strings from the ELM327

`NO DATA`, `SEARCHING...`, `UNABLE TO CONNECT`, `BUS INIT: ...`, `STOPPED`, `BUFFER FULL`, `?`
(unknown command), `CAN ERROR`. The client recognizes these and maps them to typed results rather
than treating them as hex.

## References
- ELM327 datasheet (Elm Electronics) — AT command set and protocols.
- Wikipedia: OBD-II PIDs — PID formulas (cross-checked).
- ISO 15765-4 (CAN), ISO 14230-4 (KWP2000), ISO 9141-2.
