import { useEffect, useRef, useState } from 'react';

interface Props {
  id: string;
  label: string;
  unit?: string;
  value: number;
  /** Called with a finite number on Enter or blur. Throwing is not expected here; callers validate. */
  onCommit(value: number): void;
  onInvalid?(message: string): void;
  disabled?: boolean;
}

/** Numeric input that commits on Enter/blur, reverts on Escape, and refuses non-numbers. */
export function NumberField({ id, label, unit, value, onCommit, onInvalid, disabled }: Props) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    const v = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(v)) {
      onInvalid?.(`${label}: "${text}" is not a number.`);
      setText(String(value));
      return;
    }
    if (v !== value) onCommit(v);
    else setText(String(value));
  };

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {unit ? <span className="unit">{unit}</span> : null}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          if (cancelled.current) { cancelled.current = false; return; }
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            setText(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}
