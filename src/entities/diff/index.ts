export {
  hunkPatch,
  parseDiff,
  toSplitRows,
  type DiffFile,
  type DiffLine,
  type DiffLineKind,
  type SplitRow,
} from './model/parseDiff';
export { fileRisk, sortByRisk, type FileRisk } from './model/risk';
export { default as DiffView, type DiffMode } from './ui/DiffView';
