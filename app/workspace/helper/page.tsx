import HelperPage from '@/app/helper/page'
import WorkspaceShell from '@/components/workspace-shell'

export default function HelperWorkspacePage() {
  return <WorkspaceShell role="helper"><HelperPage /></WorkspaceShell>
}

export const metadata = { title: 'Helper workspace | Ring Safe' }
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
