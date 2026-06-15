import { notFound } from 'next/navigation'
import IntakeForm from '@/components/IntakeForm'
import { getPublicTenant } from '@/lib/tenant-public'

export const dynamic = 'force-dynamic'

// Per-shop intake form: /s/{slug}. Resolves the workspace's branding and themes
// the form to it. Unknown slug → 404.
export default async function TenantIntake({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const branding = await getPublicTenant(slug)
  if (!branding) notFound()
  return <IntakeForm branding={branding} slug={slug} />
}
