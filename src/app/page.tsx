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

const STEPS = ['Client Info', 'Job Items', 'Files & Deadline', 'Summary', 'Submit']

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

  // Active sidebar step
  const [activeStep, setActiveStep] = useState(0)
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([])

  // Draft loss warning
  const [hasInput, setHasInput] = useState(false)

  const submissionId = useRef(genSubmissionId())

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

  useEffect(() => {
    function onScroll() {
      const offsets = sectionRefs.current.map(el => el?.getBoundingClientRect().top ?? 9999)
      let active = 0
      for (let i = 0; i < offsets.length; i++) {
        if (offsets[i] < 200) active = i
      }
      setActiveStep(prev => prev === active ? prev : active)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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

    const entries: UploadedFile[] = files.map((file, i) => ({
      file,
      path: presigned[i].path,
      progress: 0,
    }))
    setUploads(prev => [...prev, ...entries])

    for (let i = 0; i < files.length; i++) {
      const entry = entries[i]
      const { signedUrl, path } = presigned[i]
      try {
        await axios.put(signedUrl, entry.file, {
          headers: { 'Content-Type': entry.file.type || 'application/octet-stream' },
          onUploadProgress: (evt) => {
            const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
            setUploads(prev => prev.map(u => u.path === path ? { ...u, progress: pct } : u))
          },
        })
      } catch {
        setUploads(prev => prev.map(u => u.path === path ? { ...u, error: 'Upload failed — check connection' } : u))
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

  function scrollToSection(idx: number) {
    sectionRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Success screen ────────────────────────────────────────────────────────

  if (refNumber) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: 'var(--font-body)' }}>
        {/* Header */}
        <header style={{ background: 'var(--charcoal)', height: '60px', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid var(--coral)' }}>
          <img src="/logo-pixel.png" alt="DDF x Pixel" style={{ height: '30px', filter: 'brightness(0) invert(1)' }} />
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', color: '#888', textTransform: 'uppercase' }}>Print Production Studio</span>
        </header>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', minHeight: 'calc(100vh - 60px)' }}>
          <div style={{ maxWidth: '520px', width: '100%' }}>

            {/* Success card */}
            <div style={{ background: '#fff', padding: '48px 40px', border: '1px solid var(--charcoal-border)', textAlign: 'center', marginBottom: '16px' }}>
              <div style={{ width: 56, height: 56, background: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                <svg viewBox="0 0 24 24" width="28" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '32px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '1px' }}>Brief Received</h1>
              <p style={{ color: 'var(--charcoal-60)', marginBottom: '28px', fontSize: '14px' }}>Your reference number — keep this safe</p>

              <div style={{ background: 'var(--coral-light)', border: '2px solid var(--coral)', padding: '20px', fontSize: '26px', fontWeight: 800, letterSpacing: '3px', color: 'var(--coral)', marginBottom: '14px', fontFamily: 'var(--font-heading)' }}>{refNumber}</div>
              <button onClick={copyRef} style={{ background: copied ? '#1B7F4F' : 'var(--charcoal)', color: '#fff', border: 'none', padding: '12px 24px', fontFamily: 'var(--font-body)', fontWeight: 700, cursor: 'pointer', marginBottom: '32px', width: '100%', fontSize: '13px', letterSpacing: '1px', textTransform: 'uppercase' }}>
                {copied ? '✓ Copied to clipboard!' : 'Copy Reference Number'}
              </button>

              {/* What happens next */}
              <div style={{ background: 'var(--bg)', border: '1px solid var(--charcoal-border)', padding: '20px 24px', textAlign: 'left', marginBottom: '24px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--charcoal-60)', marginBottom: '14px' }}>What happens next</div>
                {[
                  ['A confirmation email has been sent to you', 'with a full copy of your brief attached.'],
                  ['We\'ll review and quote within 24 hours', 'reply to the email to ask any questions.'],
                  ['Production begins once you approve the quote', 'standard turnaround is 48 hours from approval.'],
                ].map(([bold, rest], i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: i < 2 ? '12px' : 0 }}>
                    <span style={{ flexShrink: 0, width: '20px', height: '20px', background: 'var(--coral)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, borderRadius: '50%' }}>{i + 1}</span>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.55, color: 'var(--charcoal)' }}>
                      <strong>{bold}</strong>{' '}{rest}
                    </p>
                  </div>
                ))}
              </div>

              <p style={{ color: '#C62828', fontSize: '12px', fontWeight: 700, margin: 0 }}>Do not re-submit — your job has been saved.</p>
            </div>

            {/* Action links */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <a href="/portal" style={{ display: 'block', background: 'var(--charcoal)', color: '#fff', padding: '14px 20px', textAlign: 'center', textDecoration: 'none', fontWeight: 700, fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                Track Your Jobs →
              </a>
              <a href="/" style={{ display: 'block', background: '#fff', color: 'var(--charcoal)', border: '1px solid var(--charcoal-border)', padding: '14px 20px', textAlign: 'center', textDecoration: 'none', fontWeight: 700, fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
                Submit Another Brief
              </a>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .layout-grid {
          display: grid;
          grid-template-columns: 280px 1fr;
          min-height: calc(100vh - 60px);
        }
        @media (max-width: 900px) {
          .layout-grid { grid-template-columns: 1fr; }
          .sidebar { display: none !important; }
          .mobile-steps { display: flex !important; }
        }
        .mobile-steps {
          display: none;
          background: var(--charcoal);
          padding: 10px 16px;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #2a2a2a;
          position: sticky;
          top: 60px;
          z-index: 40;
        }
        .mobile-steps-dots {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .mobile-step-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #333;
        }
        .mobile-step-dot.active {
          background: var(--coral);
        }
        .mobile-step-dot.done {
          background: #555;
        }
        .form-col-inner {
          max-width: 700px;
          margin: 0 auto;
          padding: 48px 40px 80px;
        }
        @media (max-width: 700px) {
          .form-col-inner { padding: 24px 16px 48px; }
        }
        input, select, textarea {
          font-family: var(--font-body);
        }
        @media print {
          .sidebar, header, .intro-bar, .form-actions { display: none !important; }
        }
      `}</style>

      {/* Header */}
      <header style={{ background: 'var(--charcoal)', height: '60px', padding: '0 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, borderBottom: '2px solid var(--coral)' }}>
        <img src="/logo-pixel.png" alt="DDF x Pixel" style={{ height: '30px', width: 'auto', filter: 'brightness(0) invert(1)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', color: '#888', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>Print Production Studio</span>
          <a href="mailto:hello@ddfevents.ca" style={{ fontSize: '13px', color: 'var(--coral)', textDecoration: 'none', fontWeight: 600 }}>hello@ddfevents.ca</a>
        </div>
      </header>

      {/* Intro bar */}
      <div style={{ background: 'var(--bg)', padding: '32px 40px 0', borderBottom: '1px solid var(--charcoal-border)' }}>
        <div style={{ maxWidth: '980px' }}>
          <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 700, textTransform: 'uppercase', lineHeight: 1.05, margin: 0 }}>
            Submit a <span style={{ color: 'var(--coral)' }}>Job Brief</span>
          </h1>
          <p style={{ margin: '10px 0 20px', color: 'var(--charcoal-60)', fontSize: '14px', maxWidth: 520, lineHeight: 1.6 }}>
            Complete the form below to submit your print production order. All fields marked with * are required. We aim to respond within 24 hours.
          </p>
        </div>
      </div>

      {/* Mobile step progress (hidden on desktop, shows when sidebar is hidden) */}
      <div className="mobile-steps">
        <span style={{ fontSize: '11px', fontWeight: 700, color: '#aaa', letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>
          Step {activeStep + 1} of {STEPS.length} — <span style={{ color: 'var(--coral)' }}>{STEPS[activeStep]}</span>
        </span>
        <div className="mobile-steps-dots">
          {STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollToSection(i)}
              className={`mobile-step-dot${i === activeStep ? ' active' : i < activeStep ? ' done' : ''}`}
              style={{ border: 'none', cursor: 'pointer', padding: 0 }}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="layout-grid">

        {/* Sidebar */}
        <aside className="sidebar" style={{ background: 'var(--charcoal)', color: '#fff', position: 'sticky', top: '60px', height: 'calc(100vh - 60px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', borderRight: '1px solid #222' }}>
          <div style={{ padding: '32px 24px', flex: 1 }}>
            <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: '16px', fontFamily: 'var(--font-body)' }}>Form Sections</div>
            <nav>
              {STEPS.map((step, i) => (
                <button
                  key={i}
                  onClick={() => scrollToSection(i)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '12px', width: '100%',
                    background: activeStep === i ? 'rgba(184,149,90,0.12)' : 'transparent',
                    border: 'none', cursor: 'pointer', padding: '10px 12px',
                    borderRadius: '4px', marginBottom: '4px', textAlign: 'left',
                  }}
                >
                  <span style={{
                    flexShrink: 0, width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-heading)', fontSize: '12px', fontWeight: 700,
                    background: activeStep === i ? 'var(--coral)' : '#2a2a2a',
                    color: activeStep === i ? 'var(--charcoal)' : '#666',
                    borderRadius: '3px',
                  }}>0{i + 1}</span>
                  <span>
                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: activeStep === i ? 'var(--coral)' : '#ccc', fontFamily: 'var(--font-body)', letterSpacing: '0.3px' }}>{step}</span>
                    <span style={{ display: 'block', fontSize: '11px', color: '#555', marginTop: '1px' }}>
                      {['Your name, company & email', 'What you need printed', 'Artwork, due date & notes', 'Review before submitting', 'Confirm & send brief'][i]}
                    </span>
                  </span>
                </button>
              ))}
            </nav>

            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #222' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: '12px', fontFamily: 'var(--font-body)' }}>Contact</div>
              <div style={{ fontSize: '12px', color: '#777', marginBottom: '4px', fontFamily: 'var(--font-body)' }}>Email</div>
              <a href="mailto:hello@ddfevents.ca" style={{ fontSize: '13px', color: 'var(--coral)', textDecoration: 'none', display: 'block', marginBottom: '16px' }}>hello@ddfevents.ca</a>
              <div style={{ fontSize: '12px', color: '#777', marginBottom: '4px', fontFamily: 'var(--font-body)' }}>Portal</div>
              <a href="/portal" style={{ fontSize: '13px', color: '#888', textDecoration: 'none', display: 'block' }}>Track your jobs →</a>
            </div>
          </div>

          <div style={{ margin: '0 16px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid #2a2a2a', padding: '12px 14px', borderRadius: '4px' }}>
            <p style={{ margin: 0, fontSize: '12px', color: '#888', lineHeight: 1.5, fontFamily: 'var(--font-body)' }}>
              <strong style={{ color: '#ccc' }}>No WhatsApp orders.</strong> All jobs must go through this form so we can track, quote, and deliver accurately.
            </p>
          </div>
        </aside>

        {/* Form column */}
        <div style={{ background: 'var(--bg)' }}>
          <div className="form-col-inner">

            {submitError && (
              <div style={{ background: '#fff0f0', border: '1.5px solid var(--red-err)', padding: '12px 16px', marginBottom: '24px', color: 'var(--red-err)', fontSize: '14px' }}>{submitError}</div>
            )}

            <form onSubmit={handleSubmit} noValidate>

              {/* Section 01 — Client Info */}
              <div ref={el => { sectionRefs.current[0] = el }}>
                <Section num="01" title="Client Info">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <Field label="Full name" required error={errors.clientName}>
                      <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Jane Smith" style={inputStyle(!!errors.clientName)} data-error={errors.clientName || undefined}/>
                    </Field>
                    <Field label="Company name" required error={errors.companyName}>
                      <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Events" style={inputStyle(!!errors.companyName)}/>
                    </Field>
                  </div>
                  <Field label="Contact email" required error={errors.contactEmail}>
                    <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acmeevents.com" style={inputStyle(!!errors.contactEmail)}/>
                  </Field>
                </Section>
              </div>

              {/* Section 02 — Job Items */}
              <div ref={el => { sectionRefs.current[1] = el }}>
                <Section num="02" title="Job Items">
                  {items.map((item, idx) => (
                    <div key={item.id} style={{ background: 'var(--bg)', padding: '16px', marginBottom: '12px', border: '1px solid var(--charcoal-border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--charcoal-60)', fontFamily: 'var(--font-body)' }}>Item {idx + 1}</span>
                        {items.length > 1 && (
                          <button type="button" onClick={() => removeItem(item.id)} style={{ background: 'none', border: '1px solid var(--charcoal-border)', padding: '4px 12px', fontSize: '12px', cursor: 'pointer', color: 'var(--charcoal-60)', fontFamily: 'var(--font-body)' }}>Remove</button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '12px', marginBottom: '12px' }}>
                        <Field label="Item name" required error={errors[`item-${idx}-name`]} compact>
                          <input value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} placeholder="Pull-Up Banner" style={inputStyle(!!errors[`item-${idx}-name`])}/>
                        </Field>
                        <Field label="Qty" required error={errors[`item-${idx}-qty`]} compact>
                          <input type="number" min="1" value={item.quantity} onChange={e => updateItem(item.id, 'quantity', e.target.value)} placeholder="1" style={inputStyle(!!errors[`item-${idx}-qty`])}/>
                        </Field>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <Field label="Size" required error={errors[`item-${idx}-size`]} compact>
                          <input value={item.size} onChange={e => updateItem(item.id, 'size', e.target.value)} placeholder="85cm × 200cm" style={inputStyle(!!errors[`item-${idx}-size`])}/>
                        </Field>
                        <Field label="Material" required error={errors[`item-${idx}-material`]} compact>
                          <select value={item.material} onChange={e => updateItem(item.id, 'material', e.target.value)} style={inputStyle(!!errors[`item-${idx}-material`])}>
                            <option value="">Select material</option>
                            {MATERIALS.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1).replace('-', ' ')}</option>)}
                          </select>
                        </Field>
                      </div>
                    </div>
                  ))}
                  {items.length < 10 && (
                    <button type="button" onClick={addItem} style={{ width: '100%', padding: '14px', border: '1.5px dashed var(--charcoal-border)', background: 'none', color: 'var(--charcoal-60)', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.5px' }}>+ Add Another Item</button>
                  )}
                </Section>
              </div>

              {/* Section 03 — Files & Deadline */}
              <div ref={el => { sectionRefs.current[2] = el }}>
                <Section num="03" title="Files & Deadline">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <Field label="Date required" required error={errors.dateRequired}>
                      <input type="date" value={dateRequired} min={todayStr()} onChange={e => setDateRequired(e.target.value)} style={inputStyle(!!errors.dateRequired)}/>
                    </Field>
                    <Field label="Event / project name">
                      <input value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Brand Launch 2026" style={inputStyle(false)}/>
                    </Field>
                  </div>

                  <Field label={<>Reference images <span style={{ fontWeight: 400, color: 'var(--charcoal-60)', textTransform: 'none', letterSpacing: 0 }}>— optional, up to 3 files, 50MB each</span></>} error={errors.files}>
                    {uploads.length < MAX_FILES && (
                      <div
                        onDragOver={e => { e.preventDefault(); setDropOver(true) }}
                        onDragLeave={() => setDropOver(false)}
                        onDrop={e => { e.preventDefault(); setDropOver(false); validateAndAddFiles(e.dataTransfer.files) }}
                        onClick={() => fileInputRef.current?.click()}
                        style={{ border: `2px dashed ${dropOver ? 'var(--coral)' : 'var(--charcoal-border)'}`, padding: '32px 24px', textAlign: 'center', cursor: 'pointer', background: dropOver ? 'var(--coral-light)' : '#fff', marginBottom: '8px' }}
                      >
                        <input ref={fileInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.ai,.eps,.svg" style={{ display: 'none' }} onChange={e => { validateAndAddFiles(e.target.files); e.target.value = '' }}/>
                        <svg viewBox="0 0 24 24" width="28" fill="none" stroke="var(--charcoal-60)" strokeWidth="1.5" style={{ marginBottom: '10px' }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--charcoal)', marginBottom: '4px' }}>Drop files here or click to attach</div>
                        <div style={{ fontSize: '12px', color: 'var(--charcoal-60)' }}>JPG · PNG · PDF · AI · EPS · SVG</div>
                      </div>
                    )}
                    {uploads.map(u => (
                      <div key={u.path} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff', border: '1px solid var(--charcoal-border)', padding: '10px 14px', marginBottom: '6px' }}>
                        <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.file.name}</span>
                        <span style={{ fontSize: '11px', color: 'var(--charcoal-60)', flexShrink: 0 }}>{fmtBytes(u.file.size)}</span>
                        {u.error ? (
                          <span style={{ fontSize: '11px', color: 'var(--red-err)' }}>{u.error}</span>
                        ) : u.progress < 100 ? (
                          <div style={{ width: '60px', height: '4px', background: 'var(--charcoal-border)', overflow: 'hidden' }}>
                            <div style={{ width: `${u.progress}%`, height: '100%', background: 'var(--coral)' }}/>
                          </div>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#1B7F4F', fontWeight: 700 }}>✓</span>
                        )}
                        <button type="button" onClick={() => removeUpload(u.path)} style={{ background: 'none', border: 'none', color: 'var(--charcoal-60)', cursor: 'pointer', fontSize: '16px', padding: '0 4px', lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                    <p style={{ fontSize: '12px', color: 'var(--charcoal-60)', marginTop: '6px', lineHeight: 1.6 }}>
                      Files over 50MB? Share via <a href="https://wetransfer.com" target="_blank" rel="noopener" style={{ color: 'var(--coral)', fontWeight: 600, textDecoration: 'none' }}>WeTransfer</a> or <a href="https://drive.google.com" target="_blank" rel="noopener" style={{ color: 'var(--coral)', fontWeight: 600, textDecoration: 'none' }}>Google Drive</a> and paste the link in Notes below.
                    </p>
                  </Field>

                  <Field label="Special notes / instructions">
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requirements, finishing options, delivery instructions..." rows={4} style={{ ...inputStyle(false), resize: 'vertical', minHeight: '100px' }}/>
                  </Field>
                </Section>
              </div>

              {/* Section 04 — Summary */}
              <div ref={el => { sectionRefs.current[3] = el }}>
                <Section num="04" title="Job Summary">
                  <div style={{ border: '1px solid var(--charcoal-border)', padding: '20px', background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--charcoal)', paddingBottom: '12px', marginBottom: '16px' }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px', letterSpacing: '3px', textTransform: 'uppercase' }}>PIXEL <span style={{ color: 'var(--coral)' }}>PRODUCTION</span></span>
                      <span style={{ border: '1px solid var(--charcoal-border)', color: 'var(--charcoal-60)', fontWeight: 700, fontSize: '10px', padding: '3px 10px', letterSpacing: '2px', fontFamily: 'var(--font-body)' }}>DRAFT</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', background: 'var(--bg)', padding: '12px 14px', marginBottom: '16px', fontSize: '13px' }}>
                      {[['CLIENT', clientName || '—'], ['COMPANY', companyName || '—'], ['DATE REQUIRED', dateRequired ? new Date(dateRequired + 'T00:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'], ['EVENT', eventName || '—']].map(([label, value]) => (
                        <div key={label}>
                          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '1px', color: 'var(--charcoal-60)', marginBottom: '3px' }}>{label}</div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '12px' }}>
                      <thead>
                        <tr style={{ background: 'var(--charcoal)', color: '#fff' }}>
                          {['#', 'Item', 'Qty', 'Size', 'Material'].map(h => <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {items.filter(i => i.name || i.quantity || i.size || i.material).length === 0 ? (
                          <tr><td colSpan={5} style={{ padding: '12px 10px', color: 'var(--charcoal-60)', fontStyle: 'italic' }}>No items added yet</td></tr>
                        ) : items.map((item, idx) => (item.name || item.quantity || item.size || item.material) && (
                          <tr key={item.id} style={{ background: idx % 2 === 0 ? '#fff' : 'var(--bg)' }}>
                            <td style={{ padding: '8px 10px', border: '1px solid var(--charcoal-border)' }}>{idx + 1}</td>
                            <td style={{ padding: '8px 10px', border: '1px solid var(--charcoal-border)' }}>{item.name || '—'}</td>
                            <td style={{ padding: '8px 10px', border: '1px solid var(--charcoal-border)' }}>{item.quantity || '—'}</td>
                            <td style={{ padding: '8px 10px', border: '1px solid var(--charcoal-border)' }}>{item.size || '—'}</td>
                            <td style={{ padding: '8px 10px', border: '1px solid var(--charcoal-border)', textTransform: 'capitalize' }}>{item.material || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {notes && <div style={{ background: 'var(--bg)', padding: '10px 12px', fontSize: '13px', marginBottom: '10px' }}><strong>Notes:</strong> {notes}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--charcoal-60)', paddingTop: '10px', borderTop: '1px solid var(--charcoal-border)' }}>
                      <span>{new Date().toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span>DDF-Pixel Job Intake</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => window.print()} style={{ marginTop: '12px', padding: '11px 24px', border: '1.5px solid var(--charcoal-border)', background: '#fff', fontFamily: 'var(--font-body)', fontSize: '12px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer', color: 'var(--charcoal)' }}>
                    Print / Save as PDF
                  </button>
                </Section>
              </div>

              {/* Section 05 — Submit */}
              <div ref={el => { sectionRefs.current[4] = el }}>
                <Section num="05" title="Submit">
                  <label style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '6px' }}>
                    <input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); if (e.target.checked) setErrors(p => { const er = { ...p }; delete er.confirmed; return er }) }} style={{ marginTop: '3px', accentColor: 'var(--coral)', width: '16px', height: '16px', flexShrink: 0 }}/>
                    <span style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--charcoal)' }}>
                      I confirm the details above are correct and that I own or have permission to use all supplied artwork. I understand DDF-Pixel will begin production based on this brief.
                    </span>
                  </label>
                  {errors.confirmed && <p style={{ color: 'var(--red-err)', fontSize: '13px', marginTop: '4px' }}>{errors.confirmed}</p>}

                  {/* Honeypot */}
                  <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
                    <input name="_hp" tabIndex={-1} autoComplete="off"/>
                  </div>

                  <button type="submit" disabled={submitting} style={{ marginTop: '24px', padding: '16px 48px', background: submitting ? 'var(--charcoal-60)' : 'var(--coral)', color: '#fff', border: 'none', fontFamily: 'var(--font-heading)', fontSize: '15px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', cursor: submitting ? 'default' : 'pointer' }}>
                    {submitting ? 'Submitting…' : 'Submit Job Brief'}
                  </button>
                </Section>
              </div>

            </form>
          </div>
        </div>
      </div>

      <footer style={{ background: 'var(--charcoal)', padding: '20px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '2px solid var(--coral)', flexWrap: 'wrap', gap: '8px' }}>
        <img src="/logo-pixel.png" alt="DDF x Pixel" style={{ height: '24px', filter: 'brightness(0) invert(1)' }} />
        <span style={{ fontSize: '12px', color: '#555', fontFamily: 'var(--font-body)' }}>© 2026 DDF x Pixel · All jobs submitted here only</span>
        <a href="/portal" style={{ fontSize: '12px', color: '#666', textDecoration: 'none', fontFamily: 'var(--font-body)' }}>Track your jobs →</a>
      </footer>
    </>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', padding: '28px', marginBottom: '16px', border: '1px solid var(--charcoal-border)', borderTop: '3px solid var(--coral)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: '13px', fontWeight: 700, color: 'var(--coral)', letterSpacing: '1px' }}>{num}</span>
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: '16px', textTransform: 'uppercase', letterSpacing: '1px' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({ label, required, error, children, compact }: { label: React.ReactNode; required?: boolean; error?: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{ marginBottom: compact ? 0 : '16px' }} data-error={error || undefined}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}>
        {label}{required && <span style={{ color: 'var(--coral)', marginLeft: '2px' }}>*</span>}
      </label>
      {children}
      {error && <p style={{ color: 'var(--red-err)', fontSize: '12px', marginTop: '4px', margin: '4px 0 0' }}>{error}</p>}
    </div>
  )
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 14px',
    border: `1.5px solid ${hasError ? 'var(--red-err)' : 'var(--charcoal-border)'}`,
    fontFamily: 'var(--font-body)',
    fontSize: '14px',
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box',
    borderRadius: 0,
  }
}
