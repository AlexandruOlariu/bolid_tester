/** Confirmation provenance (plan 25): the evidence that a per-car profile item (an extended DID, a
 *  module address, a routine id, a coding bit…) was checked against the real car. `experimental`
 *  keeps its meaning (non-standard, per-car data); `confirmed` records WHERE the proof lives. A
 *  `fixture` always points at a committed file — a plan-02 adapter fixture under
 *  `src/shared/obd-core/transport/fixtures/` or a sniffer capture under `docs/captures/` — which the
 *  vehicle-docs-sync test enforces. Pure type; the badge logic is in shared/vehicles/confirmation. */
export interface Confirmation {
  /** ISO date 'YYYY-MM-DD' the item was confirmed. */
  on: string;
  source: 'sniffer-capture' | 'on-car' | 'vcds-log';
  /** Repo-relative path of the evidence: a plan-02 fixture or a docs/captures/*.csv file. */
  fixture?: string;
  note?: string;
}
