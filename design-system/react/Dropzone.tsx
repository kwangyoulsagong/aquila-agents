import type { HTMLAttributes } from 'react';
import { cx } from './cx';

interface Props extends HTMLAttributes<HTMLDivElement> {
  /** Something is being dragged over it (`data-over`). */
  over?: boolean;
}

/** `.c-dropzone` — dashed area to drop files or folders on; highlights while something is dragged over. */
export function Dropzone({ over, className, ...rest }: Props) {
  return <div className={cx('c-dropzone', className)} data-over={over || undefined} {...rest} />;
}
