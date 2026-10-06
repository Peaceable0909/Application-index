'use client';
import { useState } from 'react';

/** Document-type menu. Choosing "Other" asks for a name for the kind of document. */
export default function DocTypeSelect({ types, defaultValue = 'Other', name = 'docType', labelName = 'docLabel', compact = false }: { types: readonly string[]; defaultValue?: string; name?: string; labelName?: string; compact?: boolean }) {
  const [t, setT] = useState(defaultValue);
  return (
    <>
      <select name={name} value={t} onChange={(e) => setT(e.target.value)}>{types.map((x) => <option key={x} value={x}>{x === 'Other' ? 'Other (name it)' : x}</option>)}</select>
      {t === 'Other' && <input name={labelName} required minLength={2} maxLength={40} placeholder="What kind of document? e.g. Bank statement" style={compact ? { minWidth: 220 } : { width: '100%' }} />}
    </>
  );
}
