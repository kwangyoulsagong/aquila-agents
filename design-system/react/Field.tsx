import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

/** `.c-field` — label above a control, optional monospace hint (a path) below. */
export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="c-field">
      <span className="c-field__label">{label}</span>
      {children}
      {hint && <span className="c-field__hint">{hint}</span>}
    </label>
  );
}

/** `.c-input` — single-line text input. */
export function Input({ className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cx('c-input', className)} spellCheck={false} {...rest} />;
}

/** `.c-input--multiline` — a textarea with the input look (comments, notes). */
export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea className={cx('c-input c-input--multiline', className)} rows={3} {...rest} />;
}

export interface SelectOption {
  value: string;
  label: ReactNode;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  onChange: (value: string) => void;
}

/** `.c-select` — native select with the design-system look (chevron drawn by CSS). */
export function Select({ options, onChange, className, ...rest }: SelectProps) {
  return (
    <span className={cx('c-select', className)}>
      <select className="c-select__control" onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
