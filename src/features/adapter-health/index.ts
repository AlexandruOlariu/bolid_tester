export { AdapterHealthScreen } from './ui/AdapterHealthScreen';
export { useAdapterHealth } from './hooks/useAdapterHealth';
export { useAdapterHealthStore } from './model/adapterHealthStore';
export { gradeAdapter, summarizeLatency } from './api/gradeAdapter';
export type {
  AdapterHealthInput,
  AdapterHealthResult,
  AdapterLatencyStats,
  AdapterGrade,
} from './api/gradeAdapter';
export { formatAdapterReport } from './api/adapterReport';
export {
  buildAdapterReportJson,
  reportLinkFor,
  adapterSlug,
  reportFileName,
} from './api/adapterReportJson';
export type { AdapterReportJson, AdapterReportJsonContext } from './api/adapterReportJson';
export type { AdapterShareFormat } from './hooks/useAdapterHealth';
