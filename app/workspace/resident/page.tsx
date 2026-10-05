import ResidentPage from '@/app/resident/page'
import WorkspaceShell from '@/components/workspace-shell'

export default function ResidentWorkspacePage() {
  return <WorkspaceShell role="resident"><ResidentPage /></WorkspaceShell>
}

export const metadata = {
  title: 'Resident workspace | Ring Safe',
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
