import type { DiffFile } from '../model/parseDiff';

interface Props {
  files: DiffFile[];
}

/** Unified diff, one block per file. Each file header carries `data-path` so a list can scroll to it. */
export default function DiffView({ files }: Props) {
  return (
    <div className="c-diff">
      {files.map((f) => (
        <div key={f.path} data-path={f.path}>
          <div className="c-diff__line c-diff__line--file">
            {f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
          </div>
          {f.lines.map((l, i) => (
            <div
              key={i}
              className={l.kind === 'ctx' ? 'c-diff__line' : `c-diff__line c-diff__line--${l.kind}`}
            >
              {l.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
