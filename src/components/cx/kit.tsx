import type { ReactNode, CSSProperties } from 'react'
import { Minus, Plus, X } from 'lucide-react'

// Building blocks of the "soft glass" design (see docs/design/client-experience-v2).
// Everything renders inside <Page>, which adds the .cx scope that ui.css needs.

export interface BrandLike { businessName: string; logoUrl: string | null; replyToEmail?: string | null }

export function Page({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="cx" style={style}>
      <div className="paper-grain">
        <div className="wrap">{children}</div>
      </div>
    </div>
  )
}

export function BrandLogo({ brand, height = 30 }: { brand: BrandLike; height?: number }) {
  return brand.logoUrl
    ? <img src={brand.logoUrl} alt={brand.businessName} className="logo" style={{ height }} />
    : <span style={{ fontWeight: 500, fontSize: 18, letterSpacing: '-0.02em' }}>{brand.businessName}</span>
}

export function SiteHead({ brand, right }: { brand: BrandLike; right?: ReactNode }) {
  return (
    <header className="site-head">
      <a href="/" aria-label={`${brand.businessName} home`}><BrandLogo brand={brand} /></a>
      {right && <div className="row small" style={{ gap: 18 }}>{right}</div>}
    </header>
  )
}

export function SiteFoot({ brand }: { brand: BrandLike }) {
  return (
    <footer className="between tiny muted stack-sm no-print" style={{ padding: '28px 0 36px', borderTop: '1px solid var(--line)', marginTop: 56 }}>
      <span>{brand.businessName} · Events, signage &amp; fabrication</span>
      {brand.replyToEmail && <span>Questions? <a className="link" href={`mailto:${brand.replyToEmail}`}>{brand.replyToEmail}</a></span>}
    </footer>
  )
}

export function SecHead({ n, title, aside }: { n: string; title: string; aside?: ReactNode }) {
  return (
    <div className="sec-head">
      <span className="sec-num">{n}</span>
      <h2 className="sec-title" style={{ margin: 0 }}>{title}</h2>
      {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
    </div>
  )
}

export type Tone = 'ok' | 'wait' | 'alert' | 'neutral' | 'gold'
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}

/** Label + control + error/hint. `data-error` lets the form scroll to the first problem. */
export function Field({ id, label, error, hint, full, children }: {
  id?: string; label: ReactNode; error?: string; hint?: ReactNode; full?: boolean; children: ReactNode
}) {
  return (
    <div className="field" data-error={error || undefined} style={full ? { gridColumn: '1 / -1' } : undefined}>
      {id ? <label className="label" htmlFor={id}>{label}</label> : <span className="label">{label}</span>}
      {children}
      {error ? <p className="err" role="alert">{error}</p> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="chip" aria-pressed={on} onClick={onClick}>{children}</button>
}

/** Quantity stepper that also accepts typing (24 table numbers shouldn't take 23 taps). */
export function Stepper({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const n = parseInt(value) || 0
  return (
    <div className="stepper">
      <button type="button" aria-label={`Fewer (${label})`} onClick={() => onChange(String(Math.max(1, n - 1)))}><Minus size={15} /></button>
      <input aria-label={label} inputMode="numeric" value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 5))} />
      <button type="button" aria-label={`More (${label})`} onClick={() => onChange(String(n + 1))}><Plus size={15} /></button>
    </div>
  )
}

export function FileRow({ name, size, progress, error, onRemove }: {
  name: string; size: string; progress: number; error?: string; onRemove: () => void
}) {
  const ext = (name.split('.').pop() ?? '').toUpperCase().slice(0, 4)
  return (
    <div className="filerow">
      <span className="fileicon">{ext}</span>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <div className="between small">
          <span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{name}</span>
          {!error && <span className="muted num tiny">{progress < 100 ? `${progress}% of ${size}` : size}</span>}
        </div>
        {error
          ? <p className="err">{error}</p>
          : <div className="bar"><span style={{ width: `${progress}%`, background: progress === 100 ? 'var(--sage)' : undefined }} /></div>}
      </div>
      <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)' }}><X size={16} /></button>
    </div>
  )
}
