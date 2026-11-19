import { Fragment, type ReactNode } from 'react';
import { toSplitRows, type DiffFile, type DiffLine } from '../model/parseDiff';

export type DiffMode = 'unified' | 'split';

interface Props {
  files: DiffFile[];
  mode?: DiffMode;
  /** File highlighted by keyboard navigation. */
  current?: string;
  /** Lines with code (add/del/ctx) become clickable: `index` is the line's index in `file.lines`. */
  onLineClick?: (file: DiffFile, index: number) => void;
  /** Lines that carry a comment get a marker. */
  isCommented?: (file: DiffFile, index: number) => boolean;
  /** Rendered under a line (a comment editor or note). */
  renderAfter?: (file: DiffFile, index: number) => ReactNode;
  renderFileActions?: (file: DiffFile) => ReactNode;
  renderHunkActions?: (file: DiffFile, hunk: number) => ReactNode;
}

const kindClass = (l: DiffLine) =>
  l.kind === 'ctx' ? 'c-diff__line' : `c-diff__line c-diff__line--${l.kind}`;
const codeLine = (l: DiffLine) => l.kind === 'add' || l.kind === 'del' || l.kind === 'ctx';
const num = (n: number | undefined) => <span className="c-diff__num">{n ?? ''}</span>;

/**
 * Unified or side-by-side diff, one block per file. Each file block carries `data-path` so a list can scroll to it.
 * Comments, stage/revert buttons and the like come in through the render props; this view has no actions of its own.
 */
export default function DiffView({
  files,
  mode = 'unified',
  current,
  onLineClick,
  isCommented,
  renderAfter,
  renderFileActions,
  renderHunkActions,
}: Props) {
  const lineProps = (file: DiffFile, l: DiffLine, index: number) =>
    onLineClick && codeLine(l)
      ? {
          'data-commentable': '',
          'data-commented': isCommented?.(file, index) ? '' : undefined,
          onClick: () => {
            // Selecting text to copy shouldn't open a comment.
            if (!window.getSelection()?.toString()) onLineClick(file, index);
          },
        }
      : {};

  const special = (file: DiffFile, l: DiffLine) => (
    <div className={kindClass(l)}>
      <span>{l.text}</span>
      {l.kind === 'hunk' && l.hunk !== undefined && renderHunkActions && (
        <span className="c-diff__actions">{renderHunkActions(file, l.hunk)}</span>
      )}
    </div>
  );

  return (
    <div className={mode === 'split' ? 'c-diff c-diff--split' : 'c-diff'}>
      {files.map((f) => (
        <div
          key={f.path}
          className="c-diff__file"
          data-path={f.path}
          aria-current={current === f.path || undefined}
        >
          <div className="c-diff__line c-diff__line--file">
            <span>{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
            {renderFileActions && <span className="c-diff__actions">{renderFileActions(f)}</span>}
          </div>
          {mode === 'unified'
            ? f.lines.map((l, i) => (
                <Fragment key={i}>
                  {codeLine(l) ? (
                    <div className={kindClass(l)} {...lineProps(f, l, i)}>
                      {num(l.oldNo)}
                      {num(l.newNo)}
                      {l.text}
                    </div>
                  ) : (
                    special(f, l)
                  )}
                  {renderAfter?.(f, i)}
                </Fragment>
              ))
            : toSplitRows(f.lines).map((r) => (
                <Fragment key={r.index}>
                  {r.full ? (
                    special(f, r.full)
                  ) : (
                    <div className="c-diff__row">
                      {r.left ? (
                        <div className={kindClass(r.left)} {...lineProps(f, r.left, r.index)}>
                          {num(r.left.oldNo)}
                          {r.left.text.slice(1)}
                        </div>
                      ) : (
                        <div className="c-diff__line c-diff__line--empty" />
                      )}
                      {r.right ? (
                        <div
                          className={kindClass(r.right)}
                          {...lineProps(f, r.right, r.rightIndex ?? r.index)}
                        >
                          {num(r.right.newNo)}
                          {r.right.text.slice(1)}
                        </div>
                      ) : (
                        <div className="c-diff__line c-diff__line--empty" />
                      )}
                    </div>
                  )}
                  {renderAfter?.(f, r.index)}
                  {r.rightIndex !== undefined && r.rightIndex !== r.index && renderAfter?.(f, r.rightIndex)}
                </Fragment>
              ))}
        </div>
      ))}
    </div>
  );
}
