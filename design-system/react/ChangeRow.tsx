import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** One git status letter: M A D R C U ?. Colors the letter. */
  status: string;
  path: string;
  /** Optional tag after the path (e.g. a risk `Badge`, T57). */
  badge?: ReactNode;
}

/** `.c-change` — a changed file: status letter, file name, dimmed directory, optional badge. */
export function ChangeRow({ status, path, badge, className, type = 'button', ...rest }: Props) {
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
      {badge}
    </button>
  );
}
