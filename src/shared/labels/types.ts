/** Label packs — the app's open equivalent of VCDS label files. A pack names a module's
 *  measuring DIDs, coding bits and adaptation channels, keyed by the module PART NUMBER prefix
 *  (read live via UDS F187), so one pack covers every car using that module family. Packs are
 *  DATA (community-extensible); everything remains experimental until confirmed on a real car. */

export interface MeasurementLabel {
  name: string;
  unit?: string;
}

export interface CodingBitLabel {
  byte: number;
  bit?: number;
  name: string;
}

export interface AdaptationLabel {
  name: string;
  unit?: string;
  description?: string;
}

export interface LabelPack {
  id: string;
  /** Display name of the module family, e.g. 'EDC17 engine (2.0 TDI CR)'. */
  module: string;
  /** F187 part-number prefixes this pack applies to (longest match wins across packs). */
  partNumberPrefixes: string[];
  /** DID (hex, e.g. '1701') -> measuring-value label. */
  measurements?: Record<string, MeasurementLabel>;
  /** Coding DID -> bit/byte field labels. */
  codingBits?: Record<string, CodingBitLabel[]>;
  /** Adaptation DID -> label. */
  adaptations?: Record<string, AdaptationLabel>;
}
