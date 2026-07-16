import { useId } from 'react';

export function Switch({
  checked,
  description,
  disabled = false,
  label,
  onCheckedChange,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="setting-row">
      <div>
        <label className="setting-label" htmlFor={id}>
          {label}
        </label>
        <p className="setting-description" id={descriptionId}>
          {description}
        </p>
      </div>
      <button
        className="ui-switch"
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={descriptionId}
        disabled={disabled}
        data-state={checked ? 'checked' : 'unchecked'}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ui-switch-thumb" aria-hidden="true" />
      </button>
    </div>
  );
}
