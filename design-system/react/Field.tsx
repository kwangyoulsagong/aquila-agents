import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

/** `.c-field` — label above a control, optional monospace hint (a path) below; `warning` tints the hint. */
export function Field({
  label,
  hint,
  warning,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Shown instead of the hint, in the warning color (e.g. a duplicate folder). */
  warning?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="c-field">
      <span className="c-field__label">{label}</span>
      {children}
      {warning ? (
        <span className="c-field__hint" data-tone="warning" role="status">
          {warning}
        </span>
      ) : (
        hint && <span className="c-field__hint">{hint}</span>
      )}
    </label>
  );
}

/** `.c-field__row` — a control with a button beside it, inside a `Field`. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <span className="c-field__row">{children}</span>;
}

/** `.c-field-grid` — two short fields side by side. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="c-field-grid">{children}</div>;
}

/** `.c-input` — single-line text input. */
export function Input({ className, type = 'text', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cx('c-input', className)} spellCheck={false} {...rest} />;
}

/** `.c-input--inline` — edits a title in place inside a line (a tab): the line's size and font. */
export function InlineInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <Input className={cx('c-input--inline', className)} {...rest} />;
}

/** `.c-input--multiline` — a textarea with the input look (comments, notes). */
export function Textarea({
  className,
  code,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
  /** `.c-input--code`: monospace and taller (a settings file edited as text). */
  code?: boolean;
}) {
  return (
    <textarea
      className={cx('c-input c-input--multiline', code && 'c-input--code', className)}
      rows={3}
      {...rest}
    />
  );
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
