import { NumberField } from './NumberField.tsx';
import type { Environment } from '../core/types.ts';

interface Props {
  env: Environment;
  onChange(label: string, patch: Partial<Environment>): void;
  onInvalid(message: string): void;
}

const SELECTS = {
  waveTheory: [['airy', 'Airy (linear)'], ['stokes5', 'Stokes 5th order']],
  integrateTo: [['swl', 'Still-water level'], ['surface', 'Instantaneous surface']],
  currentProfile: [['uniform', 'Uniform'], ['power17', '1/7 power law'], ['log', 'Logarithmic']],
  sphereModel: [['slices3', 'Thesis 3-slice'], ['exact', 'Exact section']],
} as const;

export function EnvironmentPanel({ env, onChange, onInvalid }: Props) {
  const num = (key: keyof Environment, label: string, unit: string) => (
    <NumberField
      id={`env-${key}`}
      label={label}
      unit={unit}
      value={env[key] as number}
      onInvalid={onInvalid}
      onCommit={(v) => onChange(`Set ${label}`, { [key]: v } as Partial<Environment>)}
    />
  );
  const select = (key: keyof typeof SELECTS, label: string) => (
    <div className="field">
      <label htmlFor={`env-${key}`}>{label}</label>
      <select
        id={`env-${key}`}
        value={env[key] as string}
        onChange={(e) => onChange(`Set ${label}`, { [key]: e.target.value } as Partial<Environment>)}
      >
        {SELECTS[key].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
  return (
    <div className="env">
      {select('waveTheory', 'Wave theory')}
      <div className="grid3">
        {num('H', 'H', 'm')}
        {num('T', 'T', 's')}
        {num('h', 'Depth', 'm')}
      </div>
      {select('integrateTo', 'Integrate to')}
      <div className="grid2">
        {num('U_c', 'Current', 'm/s')}
        {select('currentProfile', 'Profile')}
      </div>
      <div className="grid3">
        {num('V_wind', 'Wind @10 m', 'm/s')}
        {num('Cd', 'C_d', '–')}
        {num('Cm', 'C_m', '–')}
      </div>
      <label className="check">
        <input type="checkbox" checked={env.useMacCamy} onChange={(e) => onChange('Toggle MacCamy–Fuchs', { useMacCamy: e.target.checked })} />
        MacCamy–Fuchs inertia correction (cylinders)
      </label>
      {select('sphereModel', 'Sphere model')}
    </div>
  );
}
