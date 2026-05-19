'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import axios from 'axios'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

interface JobItem {
  id: string
  name: string
  quantity: string
  size: string
  material: string
}

interface UploadedFile {
  file: File
  path: string
  progress: number
  error?: string
}

type FormErrors = Record<string, string>

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf', '.ai', '.eps', '.svg']
const MAX_FILES = 3
const MAX_BYTES = 50 * 1024 * 1024
const MATERIALS = ['vinyl', 'fabric', 'foam-board', 'acrylic', 'other']

function genId() {
  return Math.random().toString(36).slice(2)
}

function genSubmissionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function fmtBytes(n: number) {
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function IntakeForm() {
  // Client info
  const [clientName, setClientName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  // Job items
  const [items, setItems] = useState<JobItem[]>([
    { id: genId(), name: '', quantity: '', size: '', material: '' },
  ])

  // Files & deadline
  const [dateRequired, setDateRequired] = useState('')
  const [eventName, setEventName] = useState('')
  const [notes, setNotes] = useState('')
  const [uploads, setUploads] = useState<UploadedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dropOver, setDropOver] = useState(false)

  // Submit
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState('')
  const [refNumber, setRefNumber] = useState('')
  const [copied, setCopied] = useState(false)

  // Draft loss warning
  const [hasInput, setHasInput] = useState(false)

  const submissionId = useRef(genSubmissionId())

  // Track any input to show draft warning
  useEffect(() => {
    const dirty = clientName || companyName || contactEmail || dateRequired || notes ||
      items.some(i => i.name || i.quantity || i.size || i.material)
    setHasInput(Boolean(dirty))
  }, [clientName, companyName, contactEmail, dateRequired, notes, items])

  useEffect(() => {
    if (!hasInput) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasInput])

  // ── Item management ───────────────────────────────────────────────────────

  function addItem() {
    if (items.length >= 10) return
    setItems(prev => [...prev, { id: genId(), name: '', quantity: '', size: '', material: '' }])
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function updateItem(id: string, field: keyof Omit<JobItem, 'id'>, value: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  // ── File handling ─────────────────────────────────────────────────────────

  function validateAndAddFiles(fileList: FileList | null) {
    if (!fileList) return
    const newFiles: File[] = []
    const fileErrs: string[] = []

    Array.from(fileList).forEach(f => {
      if (uploads.length + newFiles.length >= MAX_FILES) {
        fileErrs.push(`Maximum ${MAX_FILES} files allowed`)
        return
      }
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (!ALLOWED_EXTS.includes(ext)) {
        fileErrs.push(`${f.name}: type not supported`)
        return
      }
      if (f.size > MAX_BYTES) {
        fileErrs.push(`${f.name}: exceeds 50MB`)
        return
      }
      newFiles.push(f)
    })

    if (fileErrs.length) {
      setErrors(prev => ({ ...prev, files: fileErrs[0] }))
    } else {
      setErrors(prev => { const e = { ...prev }; delete e.files; return e })
    }

    if (newFiles.length) uploadFiles(newFiles)
  }

  async function uploadFiles(files: File[]) {
    // Request presigned URLs
    let presigned: { path: string; signedUrl: string }[]
    try {
      const res = await axios.post('/api/upload-url', {
        files: files.map(f => ({ name: f.name, type: f.type, size: f.size })),
      })
      presigned = res.data.uploads
    } catch {
      setErrors(prev => ({ ...prev, files: 'Could not prepare upload. Try again.' }))
      return
    }

    // Add to state as uploading
    const entries: UploadedFile[] = files.map((file, i) => ({
      file,
      path: presigned[i].path,
      progress: 0,
    }))
    setUploads(prev => [...prev, ...entries])

    // Upload each file directly to Supabase Storage via signed URL
    for (let i = 0; i < files.length; i++) {
      const entry = entries[i]
      const { signedUrl, path } = presigned[i]

      try {
        await axios.put(signedUrl, entry.file, {
          headers: { 'Content-Type': entry.file.type || 'application/octet-stream' },
          onUploadProgress: (evt) => {
            const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
            setUploads(prev =>
              prev.map(u => u.path === path ? { ...u, progress: pct } : u)
            )
          },
        })
      } catch {
        setUploads(prev =>
          prev.map(u => u.path === path ? { ...u, error: 'Upload failed — check connection' } : u)
        )
      }
    }
  }

  function removeUpload(path: string) {
    setUploads(prev => prev.filter(u => u.path !== path))
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: FormErrors = {}

    if (!clientName.trim()) errs.clientName = 'Your full name is required'
    if (!companyName.trim()) errs.companyName = 'Company name is required'
    if (!contactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      errs.contactEmail = 'A valid email address is required'
    }
    if (!dateRequired) errs.dateRequired = 'Date required is needed'
    if (dateRequired && dateRequired <= todayStr()) errs.dateRequired = 'Date must be in the future'

    items.forEach((item, idx) => {
      if (!item.name.trim()) errs[`item-${idx}-name`] = 'Item name is required'
      if (!item.quantity || parseInt(item.quantity) < 1) errs[`item-${idx}-qty`] = 'Quantity must be at least 1'
      if (!item.size.trim()) errs[`item-${idx}-size`] = 'Size is required'
      if (!item.material) errs[`item-${idx}-material`] = 'Material is required'
    })

    if (!confirmed) errs.confirmed = 'Please confirm your brief before submitting'

    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')

    if (!validate()) {
      const first = document.querySelector('[data-error]')
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    // Reject if any file still uploading
    const uploading = uploads.some(u => u.progress < 100 && !u.error)
    if (uploading) {
      setSubmitError('Please wait for all files to finish uploading.')
      return
    }

    setSubmitting(true)

    try {
      const payload = {
        clientName: clientName.trim(),
        companyName: companyName.trim(),
        contactEmail: contactEmail.trim(),
        dateRequired,
        eventName: eventName.trim() || undefined,
        notes: notes.trim() || undefined,
        items: items.map(i => ({
          name: i.name.trim(),
          quantity: parseInt(i.quantity),
          size: i.size.trim(),
          material: i.material,
        })),
        filePaths: uploads.filter(u => u.progress === 100).map(u => u.path),
        submissionId: submissionId.current,
      }

      const res = await axios.post('/api/submit', payload)
      setRefNumber(res.data.referenceNumber)
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error ?? 'Something went wrong'
        : 'Something went wrong'
      setSubmitError(`${msg} — your job was not submitted. Please try again.`)
    } finally {
      setSubmitting(false)
    }
  }

  async function copyRef() {
    await navigator.clipboard.writeText(refNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (refNumber) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', padding: '24px' }}>
        <div style={{ background: '#fff', borderRadius: '8px', padding: '40px 32px', maxWidth: '440px', width: '100%', textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,.08)' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg viewBox="0 0 24 24" width="28" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Brief Received</h1>
          <p style={{ color: 'var(--charcoal-60)', marginBottom: '24px' }}>Your reference number</p>
          <div style={{ background: 'var(--coral-light)', border: '2px solid var(--coral)', borderRadius: '6px', padding: '16px', fontSize: '22px', fontWeight: 800, letterSpacing: '2px', color: 'var(--coral)', marginBottom: '16px' }}>{refNumber}</div>
          <button onClick={copyRef} style={{ background: copied ? 'var(--green-ok)' : 'var(--charcoal)', color: '#fff', border: 'none', borderRadius: '6px', padding: '10px 20px', fontFamily: 'var(--font-body)', fontWeight: 600, cursor: 'pointer', marginBottom: '24px', width: '100%' }}>
            {copied ? '✓ Copied!' : 'Copy reference number'}
          </button>
          <p style={{ color: 'var(--charcoal-60)', fontSize: '14px', lineHeight: 1.6 }}>
            A confirmation email has been sent with a copy of your brief.<br/><br/>
            DDF-Pixel will review your brief and be in touch within 24 hours.
          </p>
          <p style={{ color: 'var(--red-err)', fontSize: '12px', marginTop: '16px', fontWeight: 600 }}>Do not re-submit — your job has been saved.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--charcoal)', WebkitFontSmoothing: 'antialiased' }}>

      {/* Header */}
      <header style={{ background: 'var(--charcoal)', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 20 }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '15px', letterSpacing: '2.5px', color: '#fff', textTransform: 'uppercase' }}>DDF-Pixel</span>
        <span style={{ background: 'var(--coral)', color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', padding: '3px 9px', borderRadius: '3px', textTransform: 'uppercase' }}>Job Brief</span>
      </header>

      {/* Progress */}
      <div style={{ background: 'var(--charcoal)', paddingBottom: '14px', paddingLeft: '20px', paddingRight: '20px' }}>
        <div style={{ maxWidth: '500px', margin: '0 auto', display: 'flex', gap: '4px' }}>
          {['Client Info', 'Job Items', 'Files & Deadline', 'Summary', 'Submit'].map((s, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ height: '3px', borderRadius: '2px', background: 'var(--coral)', marginBottom: '5px' }}/>
              <span style={{ fontSize: '9px', color: 'rgba(255,255,255,.5)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{s}</span>
            </div>
          ))}
        </div>
      </div>

      <main style={{ maxWidth: '500px', margin: '0 auto', padding: '24px 16px 48px' }}>
        <div style={{ marginBottom: '28px' }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '26px', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '6px' }}>Submit a Job Brief</h1>
          <p style={{ color: 'var(--charcoal-60)', fontSize: '14px' }}>All jobs must be submitted through this form. No WhatsApp orders accepted.</p>
        </div>

        {submitError && (
          <div style={{ background: '#fff0f0', border: '1.5px solid var(--red-err)', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', color: 'var(--red-err)', fontSize: '14px' }}>{submitError}</div>
        )}

        <form onSubmit={handleSubmit} noValidate>

          {/* Section 01 — Client Info */}
          <Section num="01" title="Client Info">
            <Field label="Full name" required error={errors.clientName}>
              <input value={clientName} onChange={e => setClientName(e.target.value)} onBlur={() => clientName.trim() || setErrors(p => ({ ...p, clientName: 'Your full name is required' }))} placeholder="Jane Smith" style={inputStyle(!!errors.clientName)} data-error={errors.clientName || undefined}/>
            </Field>
            <Field label="Company name" required error={errors.companyName}>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Events" style={inputStyle(!!errors.companyName)}/>
            </Field>
            <Field label="Contact email" required error={errors.contactEmail}>
              <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acmeevents.com" style={inputStyle(!!errors.contactEmail)}/>
            </Field>
          </Section>

          {/* Section 02 — Job Items */}
          <Section num="02" title="Job Items">
            {items.map((item, idx) => (
              <div key={item.id} style={{ background: 'var(--bg)', borderRadius: '8px', padding: '14px', marginBottom: '12px', border: '1px solid var(--charcoal-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--charcoal-60)' }}>Item {idx + 1}</span>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(item.id)} style={{ background: 'none', border: '1.5px solid var(--charcoal-border)', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', cursor: 'pointer', color: 'var(--charcoal-60)' }}>Remove</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '10px', marginBottom: '10px' }}>
                  <Field label="Item name" required error={errors[`item-${idx}-name`]} compact>
                    <input value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} placeholder="Pull-Up Banner" style={inputStyle(!!errors[`item-${idx}-name`])}/>
                  </Field>
                  <Field label="Qty" required error={errors[`item-${idx}-qty`]} compact>
                    <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, 'quantity', e.target.value)} placeholder="1" style={inputStyle(!!errors[`item-${idx}-qty`])}/>
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Field label="Size" required error={errors[`item-${idx}-size`]} compact>
                    <input value={item.size} onChange={e => updateItem(item.id, 'size', e.target.value)} placeholder="85cm × 200cm" style={inputStyle(!!errors[`item-${idx}-size`])}/>
                  </Field>
                  <Field label="Material" required error={errors[`item-${idx}-material`]} compact>
                    <select value={item.material} onChange={e => updateItem(item.id, 'material', e.target.value)} style={inputStyle(!!errors[`item-${idx}-material`])}>
                      <option value="">Select</option>
                      {MATERIALS.map(m => <option key={m} value={m} style={{ textTransform: 'capitalize' }}>{m.charAt(0).toUpperCase() + m.slice(1).replace('-', ' ')}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            ))}
            {items.length < 10 && (
              <button type="button" onClick={addItem} style={{ width: '100%', padding: '12px', border: '1.5px dashed var(--charcoal-border)', borderRadius: '8px', background: 'none', color: 'var(--charcoal-60)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>+ Add Another Item</button>
            )}
          </Section>

          {/* Section 03 — Files & Deadline */}
          <Section num="03" title="Files & Deadline">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <Field label="Date required" required error={errors.dateRequired}>
                <input type="date" value={dateRequired} min={todayStr()} onChange={e => setDateRequired(e.target.value)} style={inputStyle(!!errors.dateRequired)}/>
              </Field>
              <Field label="Event / project name">
                <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Brand Launch" style={inputStyle(false)}/>
              </Field>
            </div>

            <Field label={<>Reference images <span style={{ fontWeight: 400, color: 'var(--charcoal-60)', textTransform: 'none', letterSpacing: 0 }}>— optional, up to 3 files, 50MB each</span></>} error={errors.files}>
              {uploads.length < MAX_FILES && (
                <div
                  onDragOver={e => { e.preventDefault(); setDropOver(true) }}
                  onDragLeave={() => setDropOver(false)}
                  onDrop={e => { e.preventDefault(); setDropOver(false); validateAndAddFiles(e.dataTransfer.files) }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{ border: `2px dashed ${dropOver ? 'var(--coral)' : 'var(--charcoal-border)'}`, borderRadius: '8px', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', background: dropOver ? 'var(--coral-light)' : '#fff', marginBottom: '8px' }}
                >
                  <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ai,.eps,.svg" style={{ display: 'none' }} onChange={e => { validateAndAddFiles(e.target.files); e.target.value = '' }}/>
                  <div style={{ fontSize: '22px', marginBottom: '6px' }}>📎</div>
                  <div style={{ fontWeight: 600, fontSize: '14px' }}>Tap to attach files</div>
                  <div style={{ fontSize: '11px', color: 'var(--charcoal-60)', marginTop: '4px' }}>JPG · PNG · PDF · AI · EPS · SVG</div>
                </div>
              )}
              {uploads.map(u => (
                <div key={u.path} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid var(--charcoal-border)', borderRadius: '6px', padding: '10px 12px', marginBottom: '6px' }}>
                  <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.file.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--charcoal-60)' }}>{fmtBytes(u.file.size)}</span>
                  {u.error ? (
                    <span style={{ fontSize: '11px', color: 'var(--red-err)' }}>{u.error}</span>
                  ) : u.progress < 100 ? (
                    <div style={{ width: '60px', height: '4px', background: 'var(--charcoal-border)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${u.progress}%`, height: '100%', background: 'var(--coral)', borderRadius: '2px' }}/>
                    </div>
                  ) : (
                    <span style={{ fontSize: '11px', color: 'var(--green-ok)', fontWeight: 600 }}>✓</span>
                  )}
                  <button type="button" onClick={() => removeUpload(u.path)} style={{ background: 'none', border: 'none', color: 'var(--charcoal-60)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>✕</button>
                </div>
              ))}
              <div style={{ fontSize: '12px', color: 'var(--charcoal-60)', marginTop: '6px', lineHeight: 1.5 }}>
                Large design files (&gt;50MB)? Share via <a href="https://wetransfer.com" target="_blank" rel="noopener" style={{ color: 'var(--coral)', fontWeight: 600, textDecoration: 'none' }}>WeTransfer</a> or <a href="https://drive.google.com" target="_blank" rel="noopener" style={{ color: 'var(--coral)', fontWeight: 600, textDecoration: 'none' }}>Google Drive</a> and paste the link in the Notes field below.
              </div>
            </Field>

            <Field label="Special notes / instructions">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requirements, finishing, delivery instructions..." rows={3} style={{ ...inputStyle(false), resize: 'vertical', minHeight: '80px' }}/>
            </Field>
          </Section>

          {/* Section 04 — Summary (print-ready) */}
          <Section num="04" title="Job Summary">
            <div style={{ border: '1px solid var(--charcoal-border)', borderRadius: '8px', padding: '16px', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--charcoal)', paddingBottom: '10px', marginBottom: '12px' }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: '16px', letterSpacing: '2px', textTransform: 'uppercase' }}>DDF<span style={{ color: 'var(--coral)' }}>-</span>PIXEL</span>
                <span style={{ background: 'var(--coral-light)', color: 'var(--coral)', fontWeight: 700, fontSize: '11px', padding: '3px 10px', borderRadius: '3px', letterSpacing: '1px' }}>DRAFT</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', background: 'var(--bg)', padding: '10px 12px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px' }}>
                {[
                  ['Client', clientName || '—'],
                  ['Company', companyName || '—'],
                  ['Date Required', dateRequired ? new Date(dateRequired + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'],
                  ['Event', eventName || '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--charcoal-60)', marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginBottom: '10px' }}>
                <thead>
                  <tr style={{ background: 'var(--charcoal)', color: '#fff' }}>
                    {['#', 'Item', 'Qty', 'Size', 'Material'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {items.filter(i => i.name || i.quantity || i.size || i.material).length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '10px 8px', color: 'var(--charcoal-60)', fontStyle: 'italic', fontSize: '12px' }}>No items added yet</td></tr>
                  ) : items.map((item, idx) => (item.name || item.quantity || item.size || item.material) && (
                    <tr key={item.id} style={{ background: idx % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                      <td style={{ padding: '6px 8px', border: '1px solid var(--charcoal-border)' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid var(--charcoal-border)' }}>{item.name || '—'}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid var(--charcoal-border)' }}>{item.quantity || '—'}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid var(--charcoal-border)' }}>{item.size || '—'}</td>
                      <td style={{ padding: '6px 8px', border: '1px solid var(--charcoal-border)', textTransform: 'capitalize' }}>{item.material || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {notes && <div style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: '4px', fontSize: '12px', marginBottom: '8px' }}><strong>Notes:</strong> {notes}</div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--charcoal-60)', paddingTop: '8px', borderTop: '1px solid var(--charcoal-border)' }}>
                <span>{new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span>DDF-Pixel Job Intake</span>
              </div>
            </div>
            <button type="button" onClick={() => window.print()} style={{ width: '100%', marginTop: '10px', padding: '11px', border: '1.5px solid var(--charcoal-border)', borderRadius: '8px', background: '#fff', fontFamily: 'var(--font-body)', fontSize: '13px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', color: 'var(--charcoal)' }}>
              Print / Save as PDF
            </button>
          </Section>

          {/* Section 05 — Submit */}
          <Section num="05" title="Submit">
            <label style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '4px' }}>
              <input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); if (e.target.checked) setErrors(p => { const er = {...p}; delete er.confirmed; return er }) }} style={{ marginTop: '3px', accentColor: 'var(--coral)', width: '16px', height: '16px', flexShrink: 0 }}/>
              <span style={{ fontSize: '14px', lineHeight: 1.55, color: 'var(--charcoal)' }}>
                I confirm the details above are correct and that I own or have permission to use all supplied artwork. I understand DDF-Pixel will begin production based on this brief.
              </span>
            </label>
            {errors.confirmed && <p style={{ color: 'var(--red-err)', fontSize: '13px', marginTop: '4px' }}>{errors.confirmed}</p>}

            {/* Honeypot — invisible to humans */}
            <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
              <input name="_hp" tabIndex={-1} autoComplete="off"/>
            </div>

            <button type="submit" disabled={submitting} style={{ width: '100%', marginTop: '20px', padding: '16px', background: submitting ? 'var(--charcoal-60)' : 'var(--coral)', color: '#fff', border: 'none', borderRadius: '8px', fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: submitting ? 'default' : 'pointer' }}>
              {submitting ? 'Submitting…' : 'Submit Job Brief'}
            </button>
          </Section>

        </form>
      </main>

      <footer style={{ textAlign: 'center', padding: '16px', fontSize: '12px', color: 'var(--charcoal-60)' }}>
        DDF-Pixel Job Intake &mdash; All jobs submitted here only
      </footer>

      {/* Print styles */}
      <style>{`
        @media print {
          header, .progress-wrap, h1, p, form > *:not([data-summary]) { display: none !important; }
          [data-summary] { display: block !important; }
        }
      `}</style>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '20px', marginBottom: '16px', border: '1px solid var(--charcoal-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: '11px', fontWeight: 800, letterSpacing: '1.5px', color: 'var(--coral)', background: 'var(--coral-light)', padding: '3px 8px', borderRadius: '4px' }}>{num}</span>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({ label, required, error, children, compact }: { label: React.ReactNode; required?: boolean; error?: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ marginBottom: compact ? 0 : '14px' }} data-error={error || undefined}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', color: 'var(--charcoal)' }}>
        {label}
        {required && <span style={{ color: 'var(--coral)', marginLeft: '2px' }}>*</span>}
      </label>
      {children}
      {error && <p style={{ color: 'var(--red-err)', fontSize: '12px', marginTop: '4px' }}>{error}</p>}
    </div>
  )
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    border: `1.5px solid ${hasError ? 'var(--red-err)' : 'var(--charcoal-border)'}`,
    borderRadius: '6px',
    fontFamily: 'var(--font-body)',
    fontSize: '14px',
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
  }
}
