/** Guided fault finding (6b.7): from a DTC to the data that explains it. A small, per-profile lookup
 *  mapping a fault code (or code family) to the related measuring-block DIDs, an optional guided
 *  routine, whether the freeze frame is worth reading, and a short human note. DATA only — the UI
 *  (fault-codes feature) turns a match into deep-links (Extended PIDs / Routines) + an inline freeze
 *  frame. Kept OUT of the vehicle profiles/types on purpose so guides can be curated independently of
 *  the car registry. See docs/features/fault-codes.md.
 *
 *  Matching is intentionally simple and ORDER-SENSITIVE: the first rule whose `codes` contains the
 *  generic P-code or its VAG 5-digit number, or whose `prefix` the code starts with, wins. List
 *  specific `codes` rules before broad `prefix` rules. An unmatched code falls back to GENERIC_GUIDE
 *  (freeze frame + a generic note), so every DTC row still gets a useful guide. */

export interface FaultGuide {
  /** Extended-PID DIDs (a profile's `extendedPids` keys) worth watching for this fault; deep-linked
   *  to the Extended PIDs screen. Omitted when the car exposes no relevant enhanced data. */
  relatedDids?: string[];
  /** Guided-routine id (a profile's `routines[].id`) relevant to this fault, e.g. an EGR output test
   *  or a basic-setting adaptation. Deep-linked to the Routines screen. */
  routineId?: string;
  /** Whether the freeze frame captured with this code is especially informative. */
  freezeFrame?: boolean;
  /** Short, human note: what to look at and why. */
  note: string;
}

interface GuideRule {
  /** Exact matches: generic P-code (e.g. 'P0401') and/or the VAG 5-digit code (e.g. '08213'). */
  codes?: string[];
  /** Code-prefix match, e.g. 'P040' for the EGR-flow family P0400–P0409. */
  prefix?: string;
  guide: FaultGuide;
}

// VW Golf Plus 2009 2.0 TDI — representative diesel guides. DIDs reference that profile's
// `extendedPids`; routine ids reference its `routines`. Illustrative/experimental like the rest of
// the profile — confirm on the real car.
const golfPlusGuides: GuideRule[] = [
  {
    // EGR flow / valve. Watch EGR valve position; the EGR valve output test drives it directly.
    codes: ['P0401', 'P0402', 'P0404', 'P0405', 'P0409'],
    prefix: 'P040',
    guide: {
      relatedDids: ['1708'],
      routineId: '0130',
      freezeFrame: true,
      note:
        'EGR flow/position fault. Watch the EGR valve position while running the EGR valve output ' +
        'test — a valve stuck with soot or a lazy actuator shows up as position not tracking command.',
    },
  },
  {
    // DPF (particulate filter). Watch soot/ash load, distance since regen and EGT; the stationary
    // regeneration routine is the direct action.
    codes: ['P2002', 'P2003', 'P242F', 'P2453', 'P2458', 'P2459'],
    prefix: 'P244',
    guide: {
      relatedDids: ['1702', '1701', '1703', '1704', '1706'],
      routineId: '0201',
      freezeFrame: true,
      note:
        'DPF efficiency / soot-load fault. Check soot load and mass, ash load, distance since the ' +
        'last regeneration and exhaust gas temperature. High soot with few recent regens points to ' +
        'aborted regenerations (short trips) — a stationary forced regeneration may recover it.',
    },
  },
  {
    // Boost / underboost. The closest enhanced data on this car is the intake-flap feedback; the
    // V157 basic setting re-learns the flap. Boost pressure itself is a live PID.
    codes: ['P0299', 'P0234', 'P0238', 'P2263'],
    guide: {
      relatedDids: ['170E', '170F'],
      routineId: '0301',
      freezeFrame: true,
      note:
        'Boost-pressure fault (usually underboost). Check the intake-manifold flap position and ' +
        'potentiometer, and watch boost pressure live during a moderate acceleration. Suspect a ' +
        'charge-air leak, a sticking VNT turbo actuator, or a mis-learned intake flap (run the V157 ' +
        'adaptation).',
    },
  },
  {
    // Intake manifold runner/flap (this car's documented P2015 / VAG 08213). Directly ties to the
    // V157 adaptation basic setting.
    codes: ['P2015', '08213'],
    guide: {
      relatedDids: ['170E', '170F'],
      routineId: '0301',
      freezeFrame: true,
      note:
        'Intake manifold runner/flap (V157) range/performance — a known fault on this engine. Watch ' +
        'the flap position and potentiometer, and run the V157 basic setting (Group 121) after ' +
        'cleaning or replacing the manifold.',
    },
  },
  {
    // Coolant temperature sensor 2 (this car's documented P2183 / VAG 08579). Note-only guide.
    codes: ['P2183', '08579'],
    guide: {
      freezeFrame: true,
      note:
        'Engine coolant temperature sensor 2 (radiator outlet, G83) range/performance — a known ' +
        'fault on this car. Check the sensor, its connector and wiring; compare the freeze-frame ' +
        'coolant temperature against a plausible value for the conditions.',
    },
  },
  {
    // Glow-plug circuit family. No enhanced glow-plug DID on this profile — note + freeze frame.
    codes: ['P0380', 'P0670', 'P0671', 'P0672', 'P0673', 'P0674'],
    prefix: 'P067',
    guide: {
      freezeFrame: true,
      note:
        'Glow-plug circuit fault. Check the glow-plug relay/module and the individual glow plugs; ' +
        'the freeze frame shows whether it set on a cold start. Hard cold starting and rough idle ' +
        'when cold are the usual symptoms.',
    },
  },
];

/** Per-profile guide tables. Only the reference car ships curated guides today; every other profile
 *  (and every unmatched code) uses GENERIC_GUIDE. */
const PROFILE_GUIDES: Record<string, GuideRule[]> = {
  'golf-plus-2009-20tdi': golfPlusGuides,
};

/** Fallback for any code without a specific guide: read the freeze frame + a generic note. */
export const GENERIC_GUIDE: FaultGuide = {
  freezeFrame: true,
  note:
    'No specific guide for this code yet. Read the freeze frame (the conditions captured when the ' +
    'code set) and the live data around the named system, then compare against a known-good drive.',
};

/** Resolve the guide for a fault on a given profile. Always returns a guide — the specific match if
 *  one exists (by generic P-code, VAG 5-digit code, or code prefix), otherwise GENERIC_GUIDE. */
export function matchFaultGuide(
  profileId: string,
  code: string,
  vagCode?: string | null,
): FaultGuide {
  const rules = PROFILE_GUIDES[profileId] ?? [];
  const up = code.toUpperCase();
  for (const r of rules) {
    if (r.codes && (r.codes.includes(up) || (vagCode ? r.codes.includes(vagCode) : false)))
      return r.guide;
    if (r.prefix && up.startsWith(r.prefix.toUpperCase())) return r.guide;
  }
  return GENERIC_GUIDE;
}
