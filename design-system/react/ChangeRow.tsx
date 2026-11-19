import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** One git status letter: M A D R C U ?. Colors the letter. */
  status: string;
  path: string;
}

/** `.c-change` — a changed file: status letter, file name, dimmed directory. */
export function ChangeRow({ status, path, className, type = 'button', ...rest }: Props) {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = path.slice(slash + 1);
  return (
    <button type={type} className={cx('c-change', className)} title={path} {...rest}>
      <span className="c-change__status" data-status={status}>
        {status}
      </span>
      <span className="c-change__path">
        {name} <span className="c-change__dir">{dir}</span>
      </span>
    </button>
  );
}
