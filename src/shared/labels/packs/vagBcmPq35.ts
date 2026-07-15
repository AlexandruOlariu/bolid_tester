import { LabelPack } from '../types';

/** Central-electrics / BCM (body control) coding-bit labels for the VW PQ35 platform (Golf Plus,
 *  Golf V, Jetta, Touran, …), keyed by the BCM part-number family. ILLUSTRATIVE / EXPERIMENTAL —
 *  these bit positions mirror the Golf Plus profile's own coding schema and add a few extra named
 *  bits the profile does not itself label, so the long-coding helper can surface label-pack names
 *  over the profile schema (merged additively — the profile always wins on a conflict). Confirm on
 *  the real car before trusting. See docs/features/coding.md (long-coding helper). */
export const vagBcmPq35: LabelPack = {
  id: 'vag-bcm-pq35',
  module: 'Central electrics / BCM (PQ35)',
  partNumberPrefixes: ['1K0937'],
  codingBits: {
    // Coding DID F1A0 (matches the Golf Plus profile's codeable BCM). Byte/bit positions are
    // illustrative; only the bits NOT already named by the profile schema surface from here.
    F1A0: [
      { byte: 0, bit: 2, name: 'Leaving-home lights' },
      { byte: 0, bit: 3, name: 'Coming/leaving-home via light switch' },
      { byte: 1, bit: 1, name: 'Gong with key-in-ignition' },
      { byte: 3, bit: 0, name: 'Footwell lighting' },
    ],
  },
};
