import type { ToolField } from '../lib/api';

interface Props {
  fields: ToolField[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
}

export function ToolFields({ fields, values, onChange }: Props) {
  const visible = fields.filter((f) => !f.showIf || String(values[f.showIf.key]) === String(f.showIf.equals));
  if (!visible.length) return null;

  return (
    <div>
      {visible.map((field) => {
        const id = `field-${field.key}`;
        const value = values[field.key] ?? field.default ?? '';
        return (
          <div className="field" key={field.key}>
            {field.type !== 'toggle' && <label className="field__label" htmlFor={id}>{field.label}</label>}

            {field.type === 'select' && (
              <select id={id} value={String(value)} onChange={(e) => onChange(field.key, e.target.value)}>
                {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}

            {field.type === 'range' && (
              <>
                <input
                  id={id} type="range" min={field.min} max={field.max} step={field.step ?? 1}
                  value={Number(value) || field.min || 0}
                  onChange={(e) => onChange(field.key, Number(e.target.value))}
                  aria-valuetext={String(value)}
                />
                <div className="tiny muted">{String(value)}</div>
              </>
            )}

            {field.type === 'number' && (
              <input id={id} type="number" min={field.min} max={field.max} value={value === '' ? '' : Number(value)}
                placeholder={field.placeholder} onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))} />
            )}

            {(field.type === 'text' || field.type === 'password') && (
              <input id={id} type={field.type} value={String(value)} placeholder={field.placeholder}
                autoComplete={field.type === 'password' ? 'new-password' : 'off'}
                onChange={(e) => onChange(field.key, e.target.value)} />
            )}

            {field.type === 'textarea' && (
              <textarea id={id} value={String(value)} placeholder={field.placeholder} onChange={(e) => onChange(field.key, e.target.value)} />
            )}

            {field.type === 'toggle' && (
              <label className="toggle" htmlFor={id}>
                <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(field.key, e.target.checked)} />
                <span>{field.label}</span>
              </label>
            )}

            {field.help && <div className="field__help">{field.help}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function defaultValues(fields: ToolField[]) {
  const values: Record<string, any> = {};
  for (const f of fields) if (f.default !== undefined) values[f.key] = f.default;
  return values;
}
