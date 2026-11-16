'use client'

import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import axios from 'axios'
import { renderPrintFilePreview, uploadPreviewFile, needsPreview as fileNeedsPreview } from '@/lib/proof-preview'
import type { PublicBranding } from '@/lib/tenant-public'
import { Check, Copy, Plus, X, UploadCloud, ImageIcon, CalendarHeart, Hammer } from 'lucide-react'
import { Page, SiteHead, SiteFoot, SecHead, Field, Chip, Stepper, FileRow } from '@/components/cx/kit'
import { MAX_PIECES, MAX_FILES, MAX_ITEM_FILES, MAX_FILE_BYTES, MAX_FILE_MB } from '@/lib/limits'
import { daysUntil, countdownLabel, prettyDate } from '@/lib/countdown'

// Derive the light/dark brand tints from a single brand colour so a tenant's
// whole intake page re-themes by overriding the --mauve CSS variables.
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
}
function tint(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex)
  return rgbToHex(r * (1 - amt), g * (1 - amt), b * (1 - amt))
}

// ── Types ────────────────────────────────────────────────────────────────────

interface JobItem {
  id: string
  name: string
  quantity: string
  size: string
  material: string
  description: string
  artwork: 'design' | 'final'   // 'design' = we design it (files are inspo); 'final' = client supplies the print-ready file
}

interface UploadedFile {
  file: File
  path: string
  progress: number
  error?: string
  // Final print files only: PDF/AI get a preview rendered in the browser;
  // EPS (or an AI that isn't PDF-compatible) needs the client to attach one.
  previewPath?: string
  previewBusy?: boolean
  needsPreview?: boolean
  // Object URL for showing an image upload as a thumbnail (revoked on remove/unmount).
  previewUrl?: string
}

type ItemShot = { file: File; path?: string; busy: boolean; error?: string; previewUrl?: string }

type FormErrors = Record<string, string>

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.pdf', '.ai', '.eps', '.svg', '.dxf']
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif']
const SHOT_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'
const MATERIALS = ['vinyl', 'fabric', 'foam-board', 'acrylic', 'cardstock', 'wood', 'pvc', 'metal', 'other'] as const
const MATERIAL_LABELS: Record<string, string> = {
  vinyl: 'Vinyl', fabric: 'Fabric', 'foam-board': 'Foam board', acrylic: 'Acrylic', cardstock: 'Cardstock',
  wood: 'Wood', pvc: 'PVC', metal: 'Metal', other: 'Other',
}
const FULFILL_LABELS = { pickup: 'Pick up', delivery: 'Deliver', install: 'Install' } as const
type JobType = 'event' | 'product'
type Fulfillment = keyof typeof FULFILL_LABELS

// Decide image-ness by extension: DXF arrives as image/vnd.dxf but isn't a picture.
// Files a browser can show as-is (SVG too), decided by extension: DXF can arrive
// as image/vnd.dxf but never previews, so it always needs a screenshot.
function isImageName(name: string) {
  const ext = '.' + (name.split('.').pop() ?? '').toLowerCase()
  return ext === '.svg' || IMG_EXTS.includes(ext)
}

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

export default function IntakeForm({ branding, slug }: { branding: PublicBranding; slug: string }) {
  // DDF keeps the stock mauve; other shops (/s/{slug}) tint the accent with their brand colour.
  const theme: CSSProperties = branding.logoInvert ? {} : ({
    ['--mauve']: branding.brandColor,
    ['--mauve-deep']: shade(branding.brandColor, 0.18),
    ['--mauve-wash']: tint(branding.brandColor, 0.92),
  } as CSSProperties)

  // Client info
  const [clientName, setClientName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [contactEmail, setContactEmail] = useState('')

  // Job items
  const [items, setItems] = useState<JobItem[]>([
    // Fixed id for the first piece so server and client render the same field ids.
    { id: 'item-1', name: '', quantity: '1', size: '', material: '', description: '', artwork: 'design' },
  ])
  // What the client is submitting — a design request or their own finished
  // artwork. Sets the default for every item; each item can still be switched.
  const [submitMode, setSubmitMode] = useState<'design' | 'final'>('design')
  // Event (date + venue) or products & fabrication (needed-by date + hand-over).
  const [jobType, setJobType] = useState<JobType>('event')
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup')
  // Per-item screenshot of the finished design (final-file items only): what the
  // team sees, since PDF/AI/EPS can't be shown in a browser. One per item.
  const [itemShots, setItemShots] = useState<Record<string, ItemShot>>({})
  // Per-item reference photos, keyed by item id (mirrors the job-level `uploads`).
  const [itemUploads, setItemUploads] = useState<Record<string, UploadedFile[]>>({})

  // Files & deadline
  const [dateRequired, setDateRequired] = useState('')
  const [eventName, setEventName] = useState('')
  const [notes, setNotes] = useState('')
  // Crew logistics (one set per job)
  const [setupLocation, setSetupLocation] = useState('')
  const [setupTime, setSetupTime] = useState('')
  const [removalLocation, setRemovalLocation] = useState('')
  const [removalTime, setRemovalTime] = useState('')
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
  const sectionRefs = useRef<(HTMLElement | null)[]>([])

  // Draft loss warning
  const [hasInput, setHasInput] = useState(false)

  const submissionId = useRef(genSubmissionId())

  useEffect(() => {
    const dirty = clientName || companyName || contactEmail || dateRequired || notes ||
      items.some(i => i.name || i.size || i.material)
    setHasInput(Boolean(dirty))
  }, [clientName, companyName, contactEmail, dateRequired, notes, items])

  useEffect(() => {
    if (!hasInput || refNumber) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasInput, refNumber])

  // Thumbnail object URLs: one per image upload/screenshot, revoked when removed or on unmount.
  const blobUrls = useRef(new Set<string>())
  function makeUrl(file: File) {
    const url = URL.createObjectURL(file)
    blobUrls.current.add(url)
    return url
  }
  function dropUrl(url?: string) {
    if (url && blobUrls.current.delete(url)) URL.revokeObjectURL(url)
  }
  useEffect(() => {
    const urls = blobUrls.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); urls.clear() }
  }, [])

  // Sections 0–2 are tracked by scroll position. 3 is the sticky summary card,
  // which is always near the top on desktop, so it lights up at the page end.
  useEffect(() => {
    function onScroll() {
      let active = 0
      sectionRefs.current.slice(0, 3).forEach((el, i) => {
        if ((el?.getBoundingClientRect().top ?? 9999) < 200) active = i
      })
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80) active = 3
      setActiveStep(prev => prev === active ? prev : active)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Item management ───────────────────────────────────────────────────────

  function addItem() {
    if (items.length >= MAX_PIECES) return
    setItems(prev => [...prev, { id: genId(), name: '', quantity: '1', size: '', material: '', description: '', artwork: submitMode }])
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    for (const u of itemUploads[id] ?? []) dropUrl(u.previewUrl)
    dropUrl(itemShots[id]?.previewUrl)
    setItems(prev => prev.filter(i => i.id !== id))
    setItemUploads(prev => { const next = { ...prev }; delete next[id]; return next })
    setItemShots(prev => { const next = { ...prev }; delete next[id]; return next })
    setErrors(prev => { const e = { ...prev }; delete e[`item-${id}-photos`]; delete e[`item-${id}-shot`]; return e })
  }

  function updateItem(id: string, field: keyof Omit<JobItem, 'id'>, value: string) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  // Job-wide default: sets every piece; each piece can still be switched.
  function chooseSubmitMode(val: 'design' | 'final') {
    setSubmitMode(val)
    setItems(prev => prev.map(i => ({ ...i, artwork: val })))
    setErrors(prev => { const e = { ...prev }; Object.keys(e).forEach(k => { if (k.endsWith('-photos') || k.endsWith('-shot')) delete e[k] }); return e })
    if (val === 'design') {
      setItemUploads(prev => Object.fromEntries(Object.entries(prev).map(([id, ups]) => [id, ups.filter(u => isImageName(u.file.name))])))
      Object.values(itemShots).forEach(sh => dropUrl(sh.previewUrl))
      setItemShots({})
    }
  }

  function chooseItemArtwork(itemId: string, val: 'design' | 'final') {
    updateItem(itemId, 'artwork', val)
    setErrors(prev => { const e = { ...prev }; delete e[`item-${itemId}-photos`]; delete e[`item-${itemId}-shot`]; return e })
    // Back to "design it for me": print files and the screenshot no longer apply.
    if (val === 'design') {
      setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).filter(u => isImageName(u.file.name)) }))
      removeItemShot(itemId)
    }
  }

  // ── Per-item reference photos ───────────────────────────────────────────────

  function validateAndAddItemPhotos(itemId: string, fileList: FileList | null) {
    if (!fileList) return
    const existing = itemUploads[itemId] ?? []
    const isFinal = items.find(i => i.id === itemId)?.artwork === 'final'
    const newFiles: File[] = []
    let err = ''
    Array.from(fileList).forEach(f => {
      if (existing.length + newFiles.length >= MAX_ITEM_FILES) { err = `Up to ${MAX_ITEM_FILES} files per item`; return }
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      if (isFinal ? !ALLOWED_EXTS.includes(ext) : !IMG_EXTS.includes(ext)) {
        err = isFinal ? `${f.name}: use PDF, AI, EPS, SVG, DXF, PNG or JPG` : `${f.name}: please attach an image`; return
      }
      if (f.size > MAX_FILE_BYTES) { err = `${f.name}: over ${MAX_FILE_MB} MB`; return }
      newFiles.push(f)
    })
    setErrors(prev => { const e = { ...prev }; if (err) e[`item-${itemId}-photos`] = err; else delete e[`item-${itemId}-photos`]; return e })
    if (newFiles.length) uploadItemPhotos(itemId, newFiles)
  }

  async function uploadItemPhotos(itemId: string, files: File[]) {
    let presigned: { path: string; signedUrl: string }[]
    try {
      const res = await axios.post('/api/upload-url', { files: files.map(f => ({ name: f.name, type: f.type, size: f.size })) })
      presigned = res.data.uploads
    } catch {
      setErrors(prev => ({ ...prev, [`item-${itemId}-photos`]: 'Could not prepare upload. Try again.' }))
      return
    }
    const entries: UploadedFile[] = files.map((file, i) => ({
      file, path: presigned[i].path, progress: 0, previewUrl: isImageName(file.name) ? makeUrl(file) : undefined,
    }))
    setItemUploads(prev => ({ ...prev, [itemId]: [...(prev[itemId] ?? []), ...entries] }))
    for (let i = 0; i < files.length; i++) {
      const { signedUrl, path } = presigned[i]
      try {
        await axios.put(signedUrl, entries[i].file, {
          headers: { 'Content-Type': entries[i].file.type || 'application/octet-stream' },
          onUploadProgress: evt => {
            const pct = evt.total ? Math.round((evt.loaded / evt.total) * 100) : 0
            setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).map(u => u.path === path ? { ...u, progress: pct } : u) }))
          },
        })
      } catch {
        setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).map(u => u.path === path ? { ...u, error: 'Upload failed — check connection' } : u) }))
        continue
      }
      // Final print file that browsers can't display → make a preview now.
      if (items.find(i => i.id === itemId)?.artwork === 'final' && fileNeedsPreview(files[i].name)) {
        void attachAutoPreview(itemId, path, files[i])
      }
    }
  }

  // Render page 1 of a PDF / PDF-compatible AI to PNG and upload it as the
  // proof's preview. If that's not possible (EPS…) flag the tile so the client
  // is asked for a JPG/PNG preview before they can submit.
  async function attachAutoPreview(itemId: string, path: string, file: File) {
    const set = (patch: Partial<UploadedFile>) =>
      setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).map(u => u.path === path ? { ...u, ...patch } : u) }))
    set({ previewBusy: true })
    const preview = await renderPrintFilePreview(file)
    const previewPath = preview ? await uploadPreviewFile(preview) : null
    set({ previewBusy: false, previewPath: previewPath ?? undefined, needsPreview: !previewPath })
  }

  // Screenshot of the finished design for a final-file item (JPG/PNG, one per item).
  async function setItemShot(itemId: string, fileList: FileList | null) {
    const img = fileList?.[0]
    if (!img) return
    if (!img.type.startsWith('image/') || !isImageName(img.name)) {
      setErrors(prev => ({ ...prev, [`item-${itemId}-shot`]: 'Please use a JPG or PNG screenshot' })); return
    }
    if (img.size > MAX_FILE_BYTES) {
      setErrors(prev => ({ ...prev, [`item-${itemId}-shot`]: `Screenshot is over ${MAX_FILE_MB} MB` })); return
    }
    setErrors(prev => { const e = { ...prev }; delete e[`item-${itemId}-shot`]; return e })
    dropUrl(itemShots[itemId]?.previewUrl)
    const previewUrl = makeUrl(img)
    setItemShots(prev => ({ ...prev, [itemId]: { file: img, busy: true, previewUrl } }))
    const path = await uploadPreviewFile(img)
    // Skip if the screenshot was removed or replaced while uploading.
    setItemShots(prev => prev[itemId]?.file !== img ? prev
      : ({ ...prev, [itemId]: { file: img, previewUrl, path: path ?? undefined, busy: false, error: path ? undefined : 'Upload failed — try again' } }))
  }

  function removeItemShot(itemId: string) {
    dropUrl(itemShots[itemId]?.previewUrl)
    setItemShots(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  function removeItemPhoto(itemId: string, path: string) {
    dropUrl((itemUploads[itemId] ?? []).find(u => u.path === path)?.previewUrl)
    setItemUploads(prev => ({ ...prev, [itemId]: (prev[itemId] ?? []).filter(u => u.path !== path) }))
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
      if (f.size > MAX_FILE_BYTES) {
        fileErrs.push(`${f.name}: over ${MAX_FILE_MB} MB`)
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
    const dateWord = jobType === 'event' ? 'Event date' : 'Needed-by date'
    if (!dateRequired) errs.dateRequired = `${dateWord} is needed`
    if (dateRequired && dateRequired <= todayStr()) errs.dateRequired = `${dateWord} must be in the future`
    if (jobType === 'product' && fulfillment !== 'pickup' && !setupLocation.trim()) {
      errs.setupLocation = fulfillment === 'install' ? 'Add the install address' : 'Add the delivery address'
    }

    items.forEach((item, idx) => {
      if (!item.name.trim()) errs[`item-${idx}-name`] = 'Item name is required'
      if (!item.quantity || parseInt(item.quantity) < 1) errs[`item-${idx}-qty`] = 'Quantity must be at least 1'
      if (!item.size.trim()) errs[`item-${idx}-size`] = 'Size is required'
      if (!item.material) errs[`item-${idx}-material`] = 'Material is required'
      if (item.artwork === 'final') {
        const ups = (itemUploads[item.id] ?? []).filter(u => u.progress === 100 && !u.error)
        if (ups.length === 0) errs[`item-${item.id}-photos`] = 'Attach your print-ready file, or switch to "Design it for me"'
        const shot = itemShots[item.id]
        if (ups.some(u => !isImageName(u.file.name)) && !shot?.path) {
          errs[`item-${item.id}-shot`] = shot?.busy ? 'Screenshot still uploading — one moment' : 'Add a screenshot so we can see the design'
        }
      }
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

    const allUploads = [...uploads, ...Object.values(itemUploads).flat()]
    const uploading = allUploads.some(u => (u.progress < 100 && !u.error) || u.previewBusy) || Object.values(itemShots).some(sh => sh.busy)
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
        jobType,
        fulfillment: jobType === 'product' ? fulfillment : undefined,
        // Events: venue + setup/removal. Products: delivery/install address + time (none for pickup).
        setupLocation: jobType === 'product' && fulfillment === 'pickup' ? undefined : setupLocation.trim() || undefined,
        setupTime: jobType === 'product' && fulfillment === 'pickup' ? undefined : setupTime.trim() || undefined,
        removalLocation: jobType === 'event' ? removalLocation.trim() || undefined : undefined,
        removalTime: jobType === 'event' ? removalTime.trim() || undefined : undefined,
        items: items.map(i => ({
          name: i.name.trim(),
          quantity: parseInt(i.quantity),
          size: i.size.trim(),
          material: i.material,
          description: i.description.trim() || undefined,
          // 'final' → the files ARE the artwork: they become the proof and are approved on submit
          // (the server stamps the approval fields). 'design' → they're reference/inspo images.
          ...(i.artwork === 'final'
            ? {
                proof_urls: (itemUploads[i.id] ?? []).filter(u => u.progress === 100).map(u => u.path),
                proof_previews: Object.fromEntries(
                  (itemUploads[i.id] ?? [])
                    .filter(u => u.progress === 100 && !isImageName(u.file.name) && (itemShots[i.id]?.path || u.previewPath))
                    .map(u => [u.path, (itemShots[i.id]?.path ?? u.previewPath)!])
                ),
                proof_source: 'client' as const,
              }
            : { ref_photos: (itemUploads[i.id] ?? []).filter(u => u.progress === 100).map(u => u.path) }),
        })),
        filePaths: uploads.filter(u => u.progress === 100).map(u => u.path),
        submissionId: submissionId.current,
        tenantSlug: slug,
      }
      const res = await axios.post('/api/submit', payload)
      setRefNumber(res.data.referenceNumber)
    } catch (err: unknown) {
      let msg = 'Something went wrong'
      if (axios.isAxiosError(err)) {
        const data = err.response?.data
        msg = data?.error ?? msg
        // Surface the specific field that failed validation instead of a generic message.
        const issues = data?.issues as Array<{ path?: (string | number)[]; message?: string }> | undefined
        if (Array.isArray(issues) && issues.length) {
          const first = issues[0]
          const where = (first.path ?? []).filter(p => p !== '').join(' › ')
          msg = `${msg}${where ? ` (${where})` : ''}: ${first.message ?? 'invalid value'}`
        }
      }
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
    const first = clientName.trim().split(/\s+/)[0] || 'there'
    const anyFinal = items.some(i => i.artwork === 'final')
    return (
      <Page style={theme}>
        <SiteHead brand={branding} />
        <section style={{ padding: '56px 0', display: 'grid', gap: 18, maxWidth: 640 }}>
          <span className="eyebrow">Brief received</span>
          <h1 className="display hero-title" style={{ margin: 0 }}>Thank you, <span className="serif">{first}.</span></h1>
          <p className="muted" style={{ margin: 0, fontSize: 17 }}>
            We’ve emailed a copy to {contactEmail.trim()}. Your reference opens your job page any time.
          </p>
          <div className="ticket" style={{ maxWidth: 440 }}>
            <div className="t-label">Reference</div>
            <div className="between" style={{ marginTop: 8 }}>
              <span className="t-ref" style={{ fontSize: 18 }}>{refNumber}</span>
              <button type="button" className="btn btn-sm" style={{ background: 'rgba(255,255,255,.12)', color: '#fff' }} onClick={copyRef}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <div className="tear" />
            <ol className="stack small" style={{ margin: 0, paddingLeft: 18, gap: 8, color: 'rgba(243,238,241,.85)' }}>
              <li>We review your brief today or next business day.</li>
              <li>You get a quote{anyFinal ? '' : ' and first proofs'} by email.</li>
              <li>{anyFinal ? 'Your print-ready files go to production once we confirm sizing.' : 'Approve each design online. Then we make it.'}</li>
            </ol>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a className="btn btn-ink" href="/portal">Open my job page</a>
            <a className="btn btn-quiet" href={slug === 'ddf' ? '/' : `/s/${slug}`}>Send another brief</a>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Your brief is saved. No need to send it again.</p>
        </section>
        <SiteFoot brand={branding} />
      </Page>
    )
  }

  // ── Main layout ───────────────────────────────────────────────────────────
  const isEvent = jobType === 'event'
  const units = items.reduce((s, i) => s + (parseInt(i.quantity) || 0), 0)
  const fileCount = uploads.filter(u => !u.error).length + Object.values(itemUploads).flat().filter(u => !u.error).length
  const days = dateRequired ? daysUntil(dateRequired) : null
  const steps = ['About the job', 'Your pieces', isEvent ? 'Event & files' : 'Delivery & files', 'Review & send']
  const named = items.filter(i => i.name.trim())
  const placeLine = isEvent
    ? (setupLocation.trim() || 'Venue to be confirmed')
    : fulfillment === 'pickup' ? 'Pickup at our shop' : (setupLocation.trim() || `${fulfillment === 'install' ? 'Install' : 'Delivery'} address needed`)

  return (
    <Page style={theme}>
      <SiteHead
        brand={branding}
        right={<><span className="muted hide-sm">Already sent a brief?</span><a className="btn btn-quiet btn-sm" href="/portal">Track your job</a></>}
      />

      <section style={{ padding: '40px 0 28px', display: 'grid', gap: 16, maxWidth: 820 }}>
        <span className="eyebrow">New brief · replies within 1 business day</span>
        <h1 className="display hero-title" style={{ margin: 0 }}>Tell us what you’re <span className="serif">making.</span></h1>
        <p className="muted" style={{ margin: 0, maxWidth: 580, fontSize: 17 }}>
          Event décor, signage, displays and custom fabrication. Send the details and we’ll come back with a quote or your first proof.
        </p>
      </section>

      <ol className="steps glass hide-sm no-print" style={{ listStyle: 'none', margin: '0 0 30px' }} aria-label="Brief sections">
        {steps.map((s, i) => (
          <li key={s} className="step" data-state={i < activeStep ? 'done' : i === activeStep ? 'current' : 'next'}>
            <button type="button" onClick={() => scrollToSection(i)} style={{ all: 'unset', display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
              <span className="s-num">{i < activeStep ? <Check size={12} /> : i + 1}</span>
              <span className="small" style={{ fontWeight: 500 }}>{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} noValidate className="split">
        <div className="stack" style={{ gap: 40 }}>
          {/* 01 + 02 — what it's for, who you are */}
          <div ref={el => { sectionRefs.current[0] = el }} className="stack" style={{ gap: 40 }}>
            <section>
              <SecHead n="01" title="What’s it for?" />
              <div className="grid2">
                <KindCard on={isEvent} onClick={() => setJobType('event')} icon={<CalendarHeart size={20} />}
                  title="An event" body="Weddings, galas, launches. Dance floors, backdrops and signage, delivered and installed for your date." />
                <KindCard on={!isEvent} onClick={() => setJobType('product')} icon={<Hammer size={20} />}
                  title="Products & fabrication" body="CNC wood pieces, signs, displays and large-format prints. Picked up, delivered or installed." />
              </div>
              <div className="row" style={{ marginTop: 16, flexWrap: 'wrap', gap: 8 }}>
                <span className="label" style={{ marginRight: 4 }}>Artwork</span>
                <Chip on={submitMode === 'design'} onClick={() => chooseSubmitMode('design')}>Design it for me</Chip>
                <Chip on={submitMode === 'final'} onClick={() => chooseSubmitMode('final')}>I have print-ready files</Chip>
              </div>
            </section>

            <section>
              <SecHead n="02" title="About you" />
              <div className="grid2">
                <Field id="f-name" label="Full name" error={errors.clientName}>
                  <input id="f-name" className="input" autoComplete="name" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Jane Smith" aria-invalid={!!errors.clientName} />
                </Field>
                <Field id="f-co" label="Company" error={errors.companyName}>
                  <input id="f-co" className="input" autoComplete="organization" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Events" aria-invalid={!!errors.companyName} />
                </Field>
                <Field id="f-mail" label="Email" error={errors.contactEmail} hint="Proofs and approval links go here." full>
                  <input id="f-mail" type="email" className="input" autoComplete="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acmeevents.com" aria-invalid={!!errors.contactEmail} />
                </Field>
              </div>
            </section>
          </div>

          {/* 03 — pieces */}
          <section ref={el => { sectionRefs.current[1] = el }}>
            <SecHead n="03" title="Your pieces" aside={<span className="tiny muted">{items.length} of {MAX_PIECES}</span>} />
            <div className="stack" style={{ gap: 14 }}>
              {items.map((item, idx) => {
                const ups = itemUploads[item.id] ?? []
                return (
                  <article key={item.id} className="piece">
                    <div className="between">
                      <span className="row" style={{ gap: 10 }}>
                        <span className="piece-num">{String(idx + 1).padStart(2, '0')}</span>
                        <b style={{ fontWeight: 500 }}>{item.name.trim() || 'New piece'}</b>
                      </span>
                      {items.length > 1 && <button type="button" className="link tiny" onClick={() => removeItem(item.id)}>Remove</button>}
                    </div>

                    <div className="grid2">
                      <Field id={`p-name-${item.id}`} label="What is it?" error={errors[`item-${idx}-name`]}>
                        <input id={`p-name-${item.id}`} className="input" value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)}
                          placeholder={isEvent ? 'e.g. Welcome sign' : 'e.g. Menu board'} aria-invalid={!!errors[`item-${idx}-name`]} />
                      </Field>
                      <div className="grid2" style={{ gap: 14 }}>
                        <Field label="Quantity" error={errors[`item-${idx}-qty`]}>
                          <Stepper label={`quantity of piece ${idx + 1}`} value={item.quantity} onChange={v => updateItem(item.id, 'quantity', v)} />
                        </Field>
                        <Field id={`p-size-${item.id}`} label="Size" error={errors[`item-${idx}-size`]}>
                          <input id={`p-size-${item.id}`} className="input" value={item.size} onChange={e => updateItem(item.id, 'size', e.target.value)}
                            placeholder="24 × 36 in" aria-invalid={!!errors[`item-${idx}-size`]} />
                        </Field>
                      </div>
                    </div>

                    <Field label="Material" error={errors[`item-${idx}-material`]}>
                      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                        {MATERIALS.map(m => <Chip key={m} on={item.material === m} onClick={() => updateItem(item.id, 'material', m)}>{MATERIAL_LABELS[m]}</Chip>)}
                      </div>
                    </Field>

                    <Field id={`p-desc-${item.id}`} label={item.artwork === 'design' ? 'Describe the look' : 'Anything we should know?'}>
                      <textarea id={`p-desc-${item.id}`} className="input" value={item.description} onChange={e => updateItem(item.id, 'description', e.target.value)}
                        placeholder="Colours, finish, fonts, wording, inspiration…" />
                    </Field>

                    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                      <span className="label" style={{ marginRight: 4 }}>Artwork</span>
                      <Chip on={item.artwork === 'design'} onClick={() => chooseItemArtwork(item.id, 'design')}>Design it for me</Chip>
                      <Chip on={item.artwork === 'final'} onClick={() => chooseItemArtwork(item.id, 'final')}>I have the final file</Chip>
                    </div>

                    {item.artwork === 'final' ? (
                      <div className="grid2">
                        <Field label="Print-ready file" error={errors[`item-${item.id}-photos`]} hint="Goes straight to print, exactly as supplied.">
                          <label className="drop" style={{ padding: 18, cursor: 'pointer' }}>
                            <UploadCloud size={22} color="var(--mauve-deep)" />
                            <b style={{ fontWeight: 500 }}>Add file</b>
                            <span className="tiny muted">PDF · AI · EPS · SVG · DXF · PNG · JPG</span>
                            <input type="file" multiple hidden accept={ALLOWED_EXTS.join(',')} onChange={e => { validateAndAddItemPhotos(item.id, e.target.files); e.target.value = '' }} />
                          </label>
                          {ups.map(u => (
                            <FileRow key={u.path} name={u.file.name} size={fmtBytes(u.file.size)} progress={u.progress} error={u.error} onRemove={() => removeItemPhoto(item.id, u.path)} />
                          ))}
                        </Field>
                        {(() => {
                          const shot = itemShots[item.id]
                          const needShot = ups.some(u => !isImageName(u.file.name))
                          const shotErr = errors[`item-${item.id}-shot`] ?? shot?.error
                          return (
                            <Field label={needShot ? 'Screenshot of the design (needed)' : 'Screenshot of the design'} error={shotErr}
                              hint="So our team can see it. PDF, AI and EPS don’t preview in a browser.">
                              {shot ? (
                                <div className="row" style={{ gap: 12 }}>
                                  <div className="thumb sm">{shot.previewUrl && <img src={shot.previewUrl} alt="Design screenshot" />}</div>
                                  <div className="stack" style={{ gap: 6 }}>
                                    <span className="small">{shot.busy ? 'Uploading…' : shot.error ? '' : 'Screenshot added'}</span>
                                    <div className="row" style={{ gap: 12 }}>
                                      <label className="link tiny" style={{ cursor: 'pointer' }}>
                                        Replace<input type="file" hidden accept={SHOT_ACCEPT} onChange={e => { setItemShot(item.id, e.target.files); e.target.value = '' }} />
                                      </label>
                                      <button type="button" className="link tiny" onClick={() => removeItemShot(item.id)}>Remove</button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <label className="drop" style={{ padding: 18, cursor: 'pointer' }}>
                                  <ImageIcon size={22} color="var(--mauve-deep)" />
                                  <b style={{ fontWeight: 500 }}>Add screenshot</b>
                                  <span className="tiny muted">JPG or PNG of how it should look</span>
                                  <input type="file" hidden accept={SHOT_ACCEPT} onChange={e => { setItemShot(item.id, e.target.files); e.target.value = '' }} />
                                </label>
                              )}
                            </Field>
                          )
                        })()}
                      </div>
                    ) : (
                      <Field label="Inspiration or images to use (optional)" error={errors[`item-${item.id}-photos`]}>
                        <div className="thumbs">
                          {ups.map(u => (
                            <div key={u.path} className="thumb" title={u.file.name}>
                              {u.error ? <span className="err" style={{ padding: 6, textAlign: 'center' }}>{u.error}</span>
                                : u.progress < 100 ? <span className="num">{u.progress}%</span>
                                : u.previewUrl ? <img src={u.previewUrl} alt="" />
                                : <span className="tiny muted">{u.file.name.split('.').pop()?.toUpperCase()}</span>}
                              <button type="button" className="x" aria-label={`Remove ${u.file.name}`} onClick={() => removeItemPhoto(item.id, u.path)}><X size={12} /></button>
                            </div>
                          ))}
                          {ups.length < MAX_ITEM_FILES && (
                            <label className="thumb thumb-add" aria-label="Add images">
                              +<input type="file" multiple hidden accept={IMG_EXTS.join(',')} onChange={e => { validateAndAddItemPhotos(item.id, e.target.files); e.target.value = '' }} />
                            </label>
                          )}
                        </div>
                      </Field>
                    )}
                  </article>
                )
              })}
              <button type="button" className="btn btn-quiet" disabled={items.length >= MAX_PIECES} onClick={addItem}>
                <Plus size={15} /> Add another piece
              </button>
            </div>
          </section>

          {/* 04 — date, place, files */}
          <section ref={el => { sectionRefs.current[2] = el }}>
            <SecHead n="04" title={isEvent ? 'Event & files' : 'Delivery & files'} />
            <div className="stack" style={{ gap: 18 }}>
              <div className="grid2">
                <Field id="f-date" label={isEvent ? 'Event date' : 'Needed by'} error={errors.dateRequired}
                  hint={days !== null && days > 0 ? `${days} day${days === 1 ? '' : 's'} from today.` : undefined}>
                  <input id="f-date" type="date" className="input" min={todayStr()} value={dateRequired} onChange={e => setDateRequired(e.target.value)} aria-invalid={!!errors.dateRequired} />
                </Field>
                <Field id="f-event" label={isEvent ? 'Event name' : 'Project name (optional)'}>
                  <input id="f-event" className="input" value={eventName} onChange={e => setEventName(e.target.value)} placeholder={isEvent ? 'Brand Launch 2026' : 'Winter menu refresh'} />
                </Field>
              </div>

              {isEvent ? (
                <div className="grid2">
                  <Field id="f-setup" label="Venue / setup location">
                    <input id="f-setup" className="input" value={setupLocation} onChange={e => setSetupLocation(e.target.value)} placeholder="Venue name and address" />
                  </Field>
                  <Field id="f-setup-t" label="Setup time">
                    <input id="f-setup-t" className="input" value={setupTime} onChange={e => setSetupTime(e.target.value)} placeholder="e.g. Sat Dec 12, 9:00 AM" />
                  </Field>
                  <Field id="f-rem" label="Removal location">
                    <input id="f-rem" className="input" value={removalLocation} onChange={e => setRemovalLocation(e.target.value)} placeholder="Same as setup, or other" />
                  </Field>
                  <Field id="f-rem-t" label="Removal time">
                    <input id="f-rem-t" className="input" value={removalTime} onChange={e => setRemovalTime(e.target.value)} placeholder="e.g. Sun Dec 13, 11:00 PM" />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="How should we hand it over?">
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {(Object.keys(FULFILL_LABELS) as Fulfillment[]).map(f => (
                        <Chip key={f} on={fulfillment === f} onClick={() => setFulfillment(f)}>{FULFILL_LABELS[f]}</Chip>
                      ))}
                    </div>
                  </Field>
                  {fulfillment !== 'pickup' && (
                    <div className="grid2">
                      <Field id="f-addr" label={fulfillment === 'install' ? 'Install address' : 'Delivery address'} error={errors.setupLocation}>
                        <input id="f-addr" className="input" autoComplete="street-address" value={setupLocation} onChange={e => setSetupLocation(e.target.value)} placeholder="Street, city" aria-invalid={!!errors.setupLocation} />
                      </Field>
                      <Field id="f-when" label={fulfillment === 'install' ? 'Install time' : 'Delivery window'}>
                        <input id="f-when" className="input" value={setupTime} onChange={e => setSetupTime(e.target.value)} placeholder="e.g. Thu Nov 26, morning" />
                      </Field>
                    </div>
                  )}
                </>
              )}

              <Field label="Files for the whole job" error={errors.files}>
                {uploads.length < MAX_FILES && (
                  <div
                    className="drop" role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                    onDragOver={e => { e.preventDefault(); setDropOver(true) }}
                    onDragLeave={() => setDropOver(false)}
                    onDrop={e => { e.preventDefault(); setDropOver(false); validateAndAddFiles(e.dataTransfer.files) }}
                    onClick={() => fileInputRef.current?.click()}
                    style={dropOver ? { borderColor: 'var(--mauve-deep)', background: 'var(--mauve-wash)' } : undefined}
                  >
                    <input ref={fileInputRef} type="file" multiple hidden accept={ALLOWED_EXTS.join(',')} onChange={e => { validateAndAddFiles(e.target.files); e.target.value = '' }} />
                    <UploadCloud size={26} color="var(--mauve-deep)" />
                    <b style={{ fontWeight: 500 }}>Drop {submitMode === 'design' ? 'inspiration photos, logos or files' : 'your print-ready files'} here</b>
                    <span className="tiny muted">JPG, PNG, PDF, AI, EPS, SVG or DXF · up to {MAX_FILES} files · {MAX_FILE_MB} MB each</span>
                    <span className="btn btn-quiet btn-sm" style={{ marginTop: 6 }}>Choose files</span>
                  </div>
                )}
                {uploads.map(u => (
                  <FileRow key={u.path} name={u.file.name} size={fmtBytes(u.file.size)} progress={u.progress} error={u.error} onRemove={() => removeUpload(u.path)} />
                ))}
              </Field>
              <p className="tiny muted" style={{ margin: 0 }}>Bigger than {MAX_FILE_MB} MB? Put a WeTransfer or Google Drive link in the notes.</p>

              <Field id="f-notes" label="Anything else?">
                <textarea id="f-notes" className="input" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={isEvent ? 'Finishing, access at the venue, timing…' : 'Finishing, packaging, delivery instructions…'} />
              </Field>
            </div>
          </section>
        </div>

        {/* Summary card + send */}
        <aside ref={el => { sectionRefs.current[3] = el }} className="sticky stack" style={{ gap: 14 }}>
          <div className="ticket">
            <div className="t-label">Your brief</div>
            <div className="display" style={{ fontSize: 30, marginTop: 10, color: '#fff' }}>
              {eventName.trim() || companyName.trim() || (isEvent ? 'Your event' : 'Your order')}
            </div>
            <div className="small" style={{ color: 'rgba(243,238,241,.7)', marginTop: 4 }}>{placeLine}</div>
            <div className="tear" />
            <div className="grid2" style={{ gap: 14 }}>
              <TicketStat label={isEvent ? 'Event' : 'Needed by'} value={dateRequired ? prettyDate(dateRequired) : '—'} />
              <TicketStat label="Countdown" value={days === null ? '—' : countdownLabel(days)} />
              <TicketStat label="Pieces" value={`${items.length} · ${units} unit${units === 1 ? '' : 's'}`} />
              <TicketStat label="Files" value={String(fileCount)} />
            </div>
            {named.length > 0 && (
              <>
                <div className="tear" />
                <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, color: 'rgba(243,238,241,.82)' }}>
                  {named.slice(0, 6).map(i => <li key={i.id}>{parseInt(i.quantity) || 1} × {i.name.trim()}</li>)}
                  {named.length > 6 && <li>+{named.length - 6} more</li>}
                </ul>
              </>
            )}
            <div className="tear" />
            <div className="small" style={{ color: 'rgba(243,238,241,.82)' }}>
              {submitMode === 'design' ? 'First proofs within 2–3 business days. You approve each design online.' : 'Your files go to production once we confirm sizing.'}
            </div>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={confirmed} onChange={e => { setConfirmed(e.target.checked); if (e.target.checked) setErrors(p => { const er = { ...p }; delete er.confirmed; return er }) }} />
            <span>I confirm these details are correct and that I own or have permission to use the artwork I’ve supplied.</span>
          </label>
          {errors.confirmed && <p className="err" data-error={errors.confirmed}>{errors.confirmed}</p>}
          {submitError && <div className="alert" role="alert">{submitError}</div>}

          {/* Honeypot */}
          <div className="hp" aria-hidden="true"><input name="_hp" tabIndex={-1} autoComplete="off" /></div>

          <button type="submit" className="btn btn-ink btn-block" disabled={submitting}>{submitting ? 'Sending…' : 'Send brief'}</button>
          <p className="tiny muted" style={{ margin: 0, textAlign: 'center' }}>No payment now. We quote first.</p>
        </aside>
      </form>

      <SiteFoot brand={branding} />
    </Page>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KindCard({ on, onClick, title, body, icon }: { on: boolean; onClick: () => void; title: string; body: string; icon: React.ReactNode }) {
  return (
    <button type="button" className="mode" aria-pressed={on} onClick={onClick}>
      <span className="check">{on && <Check size={13} />}</span>
      <span className="kind-icon">{icon}</span>
      <span style={{ fontSize: 20, fontWeight: 400, letterSpacing: '-0.02em', paddingRight: 30 }}>{title}</span>
      <span className="small muted">{body}</span>
    </button>
  )
}

function TicketStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-label">{label}</div>
      <div className="num" style={{ fontWeight: 500, marginTop: 4 }}>{value}</div>
    </div>
  )
}
