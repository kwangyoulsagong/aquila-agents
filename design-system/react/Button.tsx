import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost';
  /** Square button for a single glyph. */
  icon?: boolean;
  /**
   * Glyph + text label (`.c-btn--labelled`). The glyph is decorative; the label names the button and folds away
   * when a narrow tab bar needs the room (the `title`/`aria-label` keep the name then). Ignores `icon` and `children`.
   */
  glyph?: ReactNode;
  label?: string;
  /** React 19 passes `ref` as a prop; it reaches the <button> through `rest`. */
  ref?: Ref<HTMLButtonElement>;
}

/** `.c-btn` — default, primary or ghost; `icon` for a square glyph button; `glyph` + `label` for a labelled one. */
export function Button({
  variant = 'default',
  icon,
  glyph,
  label,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const labelled = label !== undefined;
  return (
    <button
      type={type}
      className={cx(
        'c-btn',
        variant !== 'default' && `c-btn--${variant}`,
        labelled ? 'c-btn--labelled' : icon && 'c-btn--icon',
        className,
      )}
      aria-label={labelled ? (rest['aria-label'] ?? label) : undefined}
      {...rest}
    >
      {labelled ? (
        <>
          {glyph !== undefined && (
            <span className="c-btn__glyph" aria-hidden="true">
              {glyph}
            </span>
          )}
          <span className="c-btn__label">{label}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
