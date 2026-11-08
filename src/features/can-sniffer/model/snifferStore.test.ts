import { useSnifferStore } from './snifferStore';

describe('snifferStore capture fields', () => {
  it('tracks capture counts and the last export, and reset() keeps the note', () => {
    const s = useSnifferStore.getState();
    s.setNote('VCDS Group 121');
    s.setCapture(120, 3);
    s.setLastExportUri('/docs/bolid-sniff-golf.csv');
    expect(useSnifferStore.getState()).toMatchObject({
      capturedLines: 120,
      dropped: 3,
      lastExportUri: '/docs/bolid-sniff-golf.csv',
      note: 'VCDS Group 121',
    });
    useSnifferStore.getState().reset();
    expect(useSnifferStore.getState()).toMatchObject({
      capturedLines: 0,
      dropped: 0,
      lastExportUri: null,
      stats: [],
      totalFrames: 0,
      note: 'VCDS Group 121',
    });
  });
});
