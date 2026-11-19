import type { ButtonHTMLAttributes, Ref } from 'react';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost';
  /** Square button for a single glyph. */
  icon?: boolean;
  /** React 19 passes `ref` as a prop; it reaches the <button> through `rest`. */
  ref?: Ref<HTMLButtonElement>;
}

/** `.c-btn` — default, primary or ghost; `icon` for a square glyph button. */
export function Button({ variant = 'default', icon, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('c-btn', variant !== 'default' && `c-btn--${variant}`, icon && 'c-btn--icon', className)}
      {...rest}
    />
  );
}
