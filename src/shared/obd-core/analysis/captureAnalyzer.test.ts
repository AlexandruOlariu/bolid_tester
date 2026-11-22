/** Capture analyzer (plan 25) on a synthetic Golf capture written in the real plan-03 CSV format
 *  (`formatCaptureCsv`). The same text is committed as docs/captures/synthetic-golf.csv — the CLI
 *  smoke in CI runs on it; `UPDATE_FIXTURES=1 npx jest captureAnalyzer` rewrites it. */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { formatCaptureCsv, parseMonitorLine } from '../obd/canMonitor';
import type { CapturedLine } from '../obd/captureBuffer';
import {
  analyzeCapture,
  decodeUds,
  fingerprintKey,
  pairRequests,
  parseCaptureCsv,
  reassembleCaptureIsoTp,
  renderReportMarkdown,
  summarizeTp20,
  tp20PairChannels,
  TP20_PAIR_WINDOW_MS,
  type CaptureFrame,
} from './captureAnalyzer';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SYNTHETIC = path.join(REPO_ROOT, 'docs/captures/synthetic-golf.csv');
const STARTED = Date.UTC(2026, 10, 20, 10, 0, 0);

/** [t_ms, adapter line] — what an ATMA + ATH1 session on the Golf could print. */
const LINES: [number, string][] = [
  [900, '5D0 05 AA BB CC DD EE'], // bus noise (not a diagnostic id)
  // Session change, single frames (padded like a real tester).
  [1000, '7E0 02 10 03 55 55 55 55 55'],
  [1012, '7E8 02 50 03'],
  // Part number: first frame (20 bytes) + flow control from the tester + two consecutive frames.
  [1100, '7E0 03 22 F1 87'],
  [1110, '7E8 10 14 62 F1 87 30 33 4C'],
  [1111, '7E0 30 00 00'],
  [1112, '7E8 21 39 30 36 30 32 32 4C'],
  [1113, '7E8 22 4D 20 20 20 20 20 20'],
  [1500, 'BUFFER FULL'], // junk → the # raw: block
  // V157 basic setting ON, then OFF.
  [2000, '7E0 04 31 01 03 01'],
  [2030, '7E8 04 71 01 03 01'],
  [4000, '7E0 04 31 02 03 01'],
  [4025, '7E8 04 71 02 03 01'],
  // A routine the ECU refuses without security access.
  [5000, '7E0 04 31 01 02 01'],
  [5020, '7E8 03 7F 31 33'],
  // TP2.0 channel to the engine (golden-trace bytes), then three keep-alives on the data channel.
  [6000, '200 01 C0 00 10 00 03 01'],
  [6010, '201 00 D0 00 03 40 07 01'],
  [6020, '740 A0 0F 8A FF 32 FF'],
  [6025, '300 A1 0F 8A FF 4A FF'],
  [7000, '740 A3'],
  [7002, '300 A1 0F 8A FF 4A FF'],
  [8000, '740 A3'],
  [8002, '300 A1 0F 8A FF 4A FF'],
  [9000, '740 A3'],
  [9002, '300 A1 0F 8A FF 4A FF'],
];

function syntheticCsv(): string {
  const lines: CapturedLine[] = LINES.map(([t, raw]) => ({
    t: STARTED + t,
    raw,
    frame: parseMonitorLine(raw),
  }));
  return formatCaptureCsv(
    {
      vehicleId: 'golf-plus-2009-20tdi',
      protocol: 'ISO 15765-4 CAN (11 bit, 500 kbaud)',
      adapter: 'synthetic (unit test)',
      startedAt: STARTED,
      note: 'Synthetic: V157 Group 121 ON then OFF, a refused routine, a TP2.0 channel',
    },
    lines,
  );
}

const frame = (tMs: number, line: string): CaptureFrame => {
  const [id, ...bytes] = line.split(' ');
  return { tMs, id, dlc: bytes.length, bytes: bytes.map((b) => parseInt(b, 16)) };
};

describe('synthetic capture fixture', () => {
  it('docs/captures/synthetic-golf.csv matches the generator (UPDATE_FIXTURES=1 rewrites it)', () => {
    const text = syntheticCsv();
    if (process.env.UPDATE_FIXTURES === '1') fs.writeFileSync(SYNTHETIC, text);
    // git may check the file out with CRLF (core.autocrlf) — compare line content.
    const committed = fs.readFileSync(SYNTHETIC, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(text);
  });
});

describe('parseCaptureCsv', () => {
  it('reads header, frames and the raw block — LF or CRLF alike', () => {
    const lf = parseCaptureCsv(syntheticCsv());
    const crlf = parseCaptureCsv(syntheticCsv().replace(/\n/g, '\r\n'));
    expect(crlf).toEqual(lf);
    expect(lf.header.vehicle).toBe('golf-plus-2009-20tdi');
    expect(lf.header.note).toMatch(/^Synthetic: V157/);
    expect(lf.frames).toHaveLength(LINES.length - 1);
    expect(lf.frames[1]).toEqual({
      tMs: 1000,
      id: '7E0',
      dlc: 8,
      bytes: [0x02, 0x10, 0x03, 0x55, 0x55, 0x55, 0x55, 0x55],
    });
    expect(lf.rawLines).toEqual(['1500\tBUFFER FULL']);
  });

  it('keeps a malformed row instead of throwing', () => {
    const f = parseCaptureCsv('t_ms,id,dlc,bytes\n10,7E0,2,02 1\nxx,7E8,1,01\n20,7E8,2,02 50\n');
    expect(f.frames).toEqual([{ tMs: 20, id: '7E8', dlc: 2, bytes: [0x02, 0x50] }]);
    expect(f.rawLines).toEqual(['10,7E0,2,02 1', 'xx,7E8,1,01']);
  });
});

describe('reassembleCaptureIsoTp', () => {
  it('reassembles FF + CFs to 20 bytes and attaches the tester’s flow control', () => {
    const msgs = reassembleCaptureIsoTp([
      frame(1100, '7E0 03 22 F1 87'),
      frame(1110, '7E8 10 14 62 F1 87 30 33 4C'),
      frame(1111, '7E0 30 00 00'),
      frame(1112, '7E8 21 39 30 36 30 32 32 4C'),
      frame(1113, '7E8 22 4D 20 20 20 20 20 20'),
    ]);
    expect(msgs).toHaveLength(2);
    const multi = msgs[1];
    expect(multi.id).toBe('7E8');
    expect(multi.bytes).toHaveLength(20);
    expect(multi.frames).toBe(3);
    expect(multi.flowControlFrom).toBe('7E0');
    expect(multi.truncated).toBeUndefined();
    expect(String.fromCharCode(...multi.bytes.slice(3)).trim()).toBe('03L906022LM');
    expect([multi.tStartMs, multi.tEndMs]).toEqual([1110, 1113]);
  });

  it('marks a message whose consecutive frame is missing as truncated', () => {
    const msgs = reassembleCaptureIsoTp([
      frame(0, '7E8 10 14 62 F1 87 30 33 4C'),
      frame(5, '7E8 22 4D 20 20 20 20 20 20'), // seq 2 where 1 was due
    ]);
    expect(msgs).toEqual([expect.objectContaining({ truncated: true, frames: 1 })]);
  });

  it('honours the single-frame length over padding and ignores non-ISO-TP frames', () => {
    const msgs = reassembleCaptureIsoTp([
      frame(0, '7E0 02 10 03 55 55 55 55 55'),
      frame(1, '7E0 A3'),
    ]);
    expect(msgs.map((m) => m.bytes)).toEqual([[0x10, 0x03]]);
  });
});

describe('decodeUds', () => {
  it('decodes requests, positive and negative responses', () => {
    expect(decodeUds([0x10, 0x03])).toEqual(
      expect.objectContaining({ kind: 'request', service: 0x10, sub: 0x03 }),
    );
    expect(decodeUds([0x50, 0x03]).kind).toBe('positive');
    const rc = decodeUds([0x31, 0x01, 0x03, 0x01]);
    expect(rc).toEqual(expect.objectContaining({ kind: 'request', sub: 1, routineId: '0301' }));
    expect(fingerprintKey(rc)).toBe('31 01 0301');
    expect(fingerprintKey(decodeUds([0x2f, 0x01, 0x30, 0x03, 0x40]))).toBe('2F 0130');
    expect(fingerprintKey(decodeUds([0x22, 0xf1, 0x87]))).toBe('22 F187');
    expect(fingerprintKey(decodeUds([0x21, 0x2a]))).toBe('21 2A');
    const neg = decodeUds([0x7f, 0x31, 0x33]);
    expect(neg).toEqual(
      expect.objectContaining({
        kind: 'negative',
        service: 0x31,
        nrc: 0x33,
        nrcName: 'securityAccessDenied',
      }),
    );
    expect(decodeUds([0xaa, 0xbb]).kind).toBe('unknown');
  });

  it('never prints a KWP login code', () => {
    const d = decodeUds([0x2b, 0x30, 0x39, 0x00, 0x00, 0x00]);
    expect(d.kind).toBe('request');
    expect(d.summary).not.toMatch(/30 39/);
  });

  it('keeps a KWP login code out of the whole report (Markdown and JSON)', () => {
    const r = analyzeCapture(
      parseCaptureCsv(
        ['t_ms,id,dlc,bytes', '100,7E0,7,06 2B 30 39 00 00 00', '120,7E8,2,01 6B'].join('\n'),
      ),
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0].request.bytes).toEqual([0x2b]);
    expect(r.pairs[0].request.redacted).toBe(true);
    expect(r.pairs[0].decodedResponse?.kind).toBe('positive');
    expect(r.fingerprints[0].example).toBe('7E0 2B (login code not shown) → 6B');
    const md = renderReportMarkdown(r);
    const json = JSON.stringify(r);
    for (const out of [md, json]) {
      expect(out).not.toMatch(/30 39/);
      expect(out).not.toMatch(/\b48,\s*57\b/); // 0x30, 0x39 as JSON numbers
    }
  });
});

describe('pairRequests', () => {
  it('skips "response pending" and pairs the final answer', () => {
    const msgs = reassembleCaptureIsoTp([
      frame(0, '7E0 04 31 01 02 01'),
      frame(50, '7E8 03 7F 31 78'),
      frame(1900, '7E8 03 7F 31 78'),
      frame(3500, '7E8 04 71 01 02 01'),
    ]);
    const [p] = pairRequests(msgs);
    expect(p.pending).toBe(2);
    expect(p.decodedResponse?.kind).toBe('positive');
    expect(p.latencyMs).toBe(3500);
  });

  it('leaves a request unanswered when the tester moves on', () => {
    const msgs = reassembleCaptureIsoTp([
      frame(0, '7E0 02 3E 80'),
      frame(10, '7E0 03 22 F1 87'),
      frame(20, '7E8 03 7F 22 31'),
    ]);
    const pairs = pairRequests(msgs);
    expect(pairs[0].response).toBeNull();
    expect(pairs[1].decodedResponse?.nrcName).toBe('requestOutOfRange');
  });
});

describe('summarizeTp20', () => {
  it('finds one setup pair and counts the keep-alives per data channel', () => {
    const t = summarizeTp20(parseCaptureCsv(syntheticCsv()).frames);
    expect(t.setupRequests).toEqual([
      { tMs: 6000, id: '200', target: 0x01, bytes: [0x01, 0xc0, 0x00, 0x10, 0x00, 0x03, 0x01] },
    ]);
    expect(t.setupResponses.map((r) => r.id)).toEqual(['201']);
    expect(t.dataChannels).toEqual([
      { id: '300', frames: 4, keepAlives: 0 },
      { id: '740', frames: 4, keepAlives: 3 },
    ]);
  });

  it('recognises the tester channel of a capture trimmed past the channel setup', () => {
    // Only the data channel: a KWP 21 01 read in a TP2.0 data block (opcode 1x, then length 00 02),
    // the module's ACK and answer, the tester's ACK, a mid-message packet (opcode 0, seq 3 — read
    // as ISO-TP it is a single frame `22 F1 87`) and a keep-alive. No 0x200 / 0x201 setup pair.
    const frames = [
      frame(100, '740 10 00 02 21 01'),
      frame(105, '300 B1'),
      frame(120, '300 10 00 04 61 01 0A 0B'),
      frame(125, '740 B1'),
      frame(500, '740 03 22 F1 87 00 00 00'),
      frame(1100, '740 A3'),
      frame(1102, '300 A1 0F 8A FF 4A FF'),
    ];
    const t = summarizeTp20(frames);
    expect(t.setupRequests).toEqual([]);
    expect(t.dataChannels).toEqual([
      { id: '300', frames: 3, keepAlives: 0 },
      { id: '740', frames: 4, keepAlives: 1 },
    ]);
    // 740 is in the ISO-TP range, but its TP2.0 data frames must not decode as requests.
    const r = analyzeCapture({ header: {}, frames, rawLines: [] });
    expect(r.pairs).toEqual([]);
    expect(r.fingerprints).toEqual([]);
  });

  it('leaves a plain ISO-TP id in 0x600–0x7FF out of the TP2.0 channels', () => {
    const t = summarizeTp20([frame(0, '7E0 02 10 03'), frame(10, '7E8 02 50 03')]);
    expect(t.dataChannels).toEqual([]);
    expect(t.warnings).toEqual([]);
  });

  it('a capture with its channel setup has no warnings', () => {
    expect(summarizeTp20(parseCaptureCsv(syntheticCsv()).frames).warnings).toEqual([]);
  });

  // Plan W2: a trimmed capture whose channel ids are outside 0x300–0x3FF and 0x600–0x7FF (the ECU
  // assigns them in the D0 answer, which was cut off). Only the id pair's TP2.0 exchanges remain.
  const TRIMMED_ODD_IDS = [
    frame(100, '4F0 10 00 02 21 01'), // tester → module: data, last packet, wants an ACK (seq 0)
    frame(104, '5E0 B1'), // module ACKs with the next sequence number
    frame(120, '5E0 10 00 04 61 01 0A 0B'), // module → tester: the answer (seq 0)
    frame(124, '4F0 B1'), // tester ACKs
    frame(500, '4F0 21 00 02 21 02'), // data, more to come, no ACK wanted (seq 1)
    frame(1100, '4F0 A3'), // channel test
    frame(1102, '5E0 A1 0F 8A FF 4A FF'), // its parameters answer
    frame(1500, '5D0 05 AA BB CC DD EE'), // bus noise
  ];

  it('infers a channel pair outside the usual ranges from its TP2.0 exchanges', () => {
    const t = summarizeTp20(TRIMMED_ODD_IDS);
    expect(t.setupRequests).toEqual([]);
    expect(t.dataChannels).toEqual([
      { id: '4F0', frames: 4, keepAlives: 1 },
      { id: '5E0', frames: 3, keepAlives: 0 },
    ]);
    expect(t.warnings).toEqual([
      'No TP2.0 channel setup (0x200 → D0 answer) in this capture: the data channels (4F0, 5E0) ' +
        'were inferred from their traffic, and the module they belong to is unknown. Keep the ' +
        'channel setup in the trimmed window.',
    ]);
    // Never decoded as ISO-TP, not even with --all-ids (`21 00 02 …` would read as a consecutive
    // frame, `10 00 02 …` as a first frame).
    const r = analyzeCapture(
      { header: {}, frames: TRIMMED_ODD_IDS, rawLines: [] },
      { allIds: true },
    );
    expect(r.pairs.some((p) => ['4F0', '5E0'].includes(p.request.id))).toBe(false);
    const md = renderReportMarkdown(r);
    expect(md).toContain('  - channel 4F0: 4 frame(s), 1 keep-alive(s)');
    expect(md).toContain('- **Warning:** No TP2.0 channel setup (0x200 → D0 answer)');
  });

  it('a single coincidental answer is no channel and no warning', () => {
    // One data frame and one ACK: below TP20_MIN_PAIR_MATCHES and one-way, so nothing is inferred
    // and nothing flagged (a one-byte broadcast after another id's frame reads the same).
    const t = summarizeTp20([frame(100, '4F0 10 00 02 21 01'), frame(104, '5E0 B1')]);
    expect(t.dataChannels).toEqual([]);
    expect(t.warnings).toEqual([]);
    // A wrong sequence number is no ACK of that frame either.
    const wrongSeq = summarizeTp20([
      frame(100, '4F0 10 00 02 21 01'),
      frame(104, '5E0 B5'),
      frame(300, '4F0 11 00 02 21 01'),
      frame(304, '5E0 B7'),
    ]);
    expect(wrongSeq.dataChannels).toEqual([]);
  });

  it('a lone channel-test exchange is too short for a channel, only a warning to keep the setup', () => {
    const t = summarizeTp20([frame(100, '4F0 A3'), frame(102, '5E0 A1 0F 8A FF 4A FF')]);
    expect(t.dataChannels).toEqual([]);
    expect(t.warnings).toEqual([
      'Frames on 4F0, 5E0 look like a TP2.0 channel test / disconnect but are too few to be tied ' +
        'to a channel, so they are not summarized as TP2.0. Keep the channel setup and both sides ' +
        'of the channel in the trimmed window.',
    ]);
  });

  it('a plain capture with a 0x3xx broadcast gets no TP2.0 warning', () => {
    // 0x3xx ids still list as channels by convention, but with no TP2.0 opcode on them there is no
    // evidence of a TP2.0 session, so nothing tells the owner to keep a setup that never existed.
    const t = summarizeTp20([
      frame(0, '7E0 02 01 0C'),
      frame(10, '7E8 04 41 0C 1A F8'),
      frame(20, '320 12 34 56 78'),
      frame(120, '320 12 34 56 79'),
      frame(130, '1A0 B3'),
      frame(140, '480 93'),
    ]);
    expect(t.dataChannels).toEqual([{ id: '320', frames: 2, keepAlives: 0 }]);
    expect(t.warnings).toEqual([]);
    // A 0x3xx id that does send a TP2.0-only opcode is TP2.0 evidence.
    const keepAlive = summarizeTp20([frame(0, '300 A3'), frame(5, '300 10 00 02 21 01')]);
    expect(keepAlive.warnings).toHaveLength(1);
    expect(keepAlive.warnings[0]).toMatch(/^No TP2.0 channel setup .* \(300\) were inferred/);
  });

  it('tp20PairChannels needs answers from the other id inside the window', () => {
    // Late answers (> TP20_PAIR_WINDOW_MS) and answers from the same id do not count.
    expect(
      tp20PairChannels([
        frame(0, '4F0 A3'),
        frame(TP20_PAIR_WINDOW_MS + 1, '5E0 A1 0F 8A FF 4A FF'),
        frame(1000, '4F0 A3'),
        frame(1001, '4F0 A1 0F 8A FF 4A FF'),
        frame(2000, '4F0 A3'),
        frame(2001 + TP20_PAIR_WINDOW_MS, '5E0 A1 0F 8A FF 4A FF'),
      ]),
    ).toEqual(new Set());
    expect(
      tp20PairChannels([
        frame(0, '4F0 A3'),
        frame(2, '5E0 A1 0F 8A FF 4A FF'),
        frame(1000, '4F0 A8'),
        frame(1003, '5E0 A8'),
      ]),
    ).toEqual(new Set([0x4f0, 0x5e0]));
  });

  it('a busy bus of broadcasts that happen to look like data frames and ACKs is no channel', () => {
    // The committed capture plus 10 Hz broadcasts: 4A0 always starts 0x02 (a "data frame, seq 2")
    // and 5D0 is a one-byte 0x93 (an "ACK of seq 2") 20 ms later, and 5E0 a one-byte rolling
    // counter 0x90–0x9F. One-way "ACKs" with no channel test are not a channel.
    const base = parseCaptureCsv(syntheticCsv()).frames;
    const end = base[base.length - 1].tMs;
    const busy: CaptureFrame[] = [...base];
    for (let t = 0, k = 0; t <= end; t += 100, k++) {
      busy.push(frame(t + 3, '4A0 02 1F 00 3C 80 00 00 00'));
      busy.push(frame(t + 23, '5D0 93'));
      busy.push(frame(t + 47, `5E0 ${(0x90 | (k & 0x0f)).toString(16).toUpperCase()}`));
      busy.push(frame(t + 61, `4B0 1${(k & 0x0f).toString(16).toUpperCase()} 22 00 00 00`));
    }
    expect(tp20PairChannels(busy)).toEqual(new Set());
    const t = summarizeTp20(busy);
    expect(t.dataChannels).toEqual([
      { id: '300', frames: 4, keepAlives: 0 },
      { id: '740', frames: 4, keepAlives: 3 },
    ]);
    // The one-byte broadcasts are neither summarized nor flagged as TP2.0.
    expect(t.warnings).toEqual([]);
  });

  it('never pairs an ISO-TP diagnostic id, so its requests still decode', () => {
    // `7E0 02 10 03` reads as a TP2.0 data frame with seq 2, and a broadcast `5D0 93` as its ACK.
    const frames = [
      frame(0, '7E0 02 10 03'),
      frame(10, '7E8 06 50 03 00 32 01 F4'),
      frame(50, '5D0 93'),
      frame(300, '7E0 02 10 03'),
      frame(310, '7E8 06 50 03 00 32 01 F4'),
      frame(350, '5D0 93'),
      frame(600, '7E0 02 10 03'),
      frame(610, '7E8 06 50 03 00 32 01 F4'),
      frame(650, '5D0 93'),
    ];
    expect(tp20PairChannels(frames)).toEqual(new Set());
    const r = analyzeCapture({ header: {}, frames, rawLines: [] });
    expect(r.tp20.dataChannels).toEqual([]);
    expect(r.pairs.filter((p) => p.request.id === '7E0' && p.response?.id === '7E8')).toHaveLength(
      3,
    );
  });

  it('a direction counts only when most of its asks are answered', () => {
    // 4F0 asks 10 times, 5E0 answers twice in each direction: a coincidence on a busy id.
    const frames: CaptureFrame[] = [];
    for (let i = 0; i < 10; i++) frames.push(frame(i * 1000, '4F0 A3'));
    frames.push(frame(2, '5E0 A1 0F 8A FF 4A FF'), frame(1002, '5E0 A1 0F 8A FF 4A FF'));
    expect(tp20PairChannels(frames)).toEqual(new Set());
  });
});

describe('analyzeCapture + renderReportMarkdown', () => {
  const report = () => analyzeCapture(parseCaptureCsv(syntheticCsv()));

  it('pairs every diagnostic request and builds the fingerprints', () => {
    const r = report();
    expect(r.pairs.map((p) => fingerprintKey(p.decodedRequest))).toEqual([
      '10 03',
      '22 F187',
      '31 01 0301',
      '31 02 0301',
      '31 01 0201',
    ]);
    expect(r.pairs.every((p) => p.response)).toBe(true);
    expect(r.pairs[1].response?.bytes).toHaveLength(20);
    expect(r.pairs[1].response?.flowControlFrom).toBe('7E0');
    expect(r.pairs[4].decodedResponse?.nrcName).toBe('securityAccessDenied');
    expect(r.fingerprints.find((f) => f.key === '31 01 0301')).toEqual({
      key: '31 01 0301',
      count: 1,
      firstMs: 2000,
      lastMs: 2000,
      example: '7E0 31 01 03 01 → 71 01 03 01',
    });
    // TP2.0 frames are summarized, never parsed as ISO-TP; bus noise is ignored.
    expect(r.pairs.some((p) => ['200', '201', '300', '740', '5D0'].includes(p.request.id))).toBe(
      false,
    );
    expect(r.frameCount).toBe(LINES.length - 1);
    expect(r.durationMs).toBe(9002 - 900);
  });

  it('narrows to a time window and to one id', () => {
    const file = parseCaptureCsv(syntheticCsv());
    const around = analyzeCapture(file, { aroundMs: 2000, windowMs: 500 });
    expect(around.fingerprints.map((f) => f.key)).toEqual(['31 01 0301']);
    expect(analyzeCapture(file, { onlyId: '7e9' }).pairs).toEqual([]);
    expect(analyzeCapture(file, { onlyId: '7e8' }).pairs).toHaveLength(5);
  });

  it('renders the fingerprints and the TP2.0 section as Markdown', () => {
    const md = renderReportMarkdown(report());
    expect(md).toContain('| `31 01 0301` | 1 | 2000 | 2000 |');
    expect(md).toContain('securityAccessDenied');
    expect(md).toContain('- Channel setup: 1 request(s), 1 response(s)');
    expect(md).toContain('- Keep-alives (A3): 3');
    expect(md).toContain('**vehicle**: golf-plus-2009-20tdi');
  });
});

describe('scripts/analyze-capture.mjs (CLI)', () => {
  const cli = path.join(REPO_ROOT, 'scripts/analyze-capture.mjs');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: REPO_ROOT });

  it('prints the Markdown report for the committed synthetic capture', () => {
    const r = run('docs/captures/synthetic-golf.csv');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('31 01 0301');
    expect(r.stdout).toContain('- Keep-alives (A3): 3');
  });

  it('--json, --around/--window and --id narrow the output', () => {
    const r = run(
      'docs/captures/synthetic-golf.csv',
      '--json',
      '--around',
      '4000',
      '--window',
      '100',
      '--id',
      '7E0',
    );
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as { fingerprints: { key: string }[] };
    expect(json.fingerprints.map((f) => f.key)).toEqual(['31 02 0301']);
  });

  it('--expect fails when the text is missing, and a bad path exits non-zero', () => {
    expect(run('docs/captures/synthetic-golf.csv', '--expect', '31 01 0301').status).toBe(0);
    expect(run('docs/captures/synthetic-golf.csv', '--expect', '31 01 9999').status).toBe(1);
    expect(run('docs/captures/nope.csv').status).toBe(2);
  });
});
