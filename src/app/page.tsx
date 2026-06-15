import IntakeForm from '@/components/IntakeForm'
import { DDF_DEFAULT_BRANDING } from '@/lib/tenant-public'

// Root intake = the default (DDF) workspace, branded exactly as before.
// Other shops use /s/{slug} (see src/app/s/[slug]/page.tsx).
export default function Home() {
  return <IntakeForm branding={DDF_DEFAULT_BRANDING} slug="ddf" />
}
