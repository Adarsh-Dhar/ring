'use client'
import Link from 'next/link'
import SimulationPanel from '@/app/workspace/[id]/SimulationPanel'
import { useWorkspace } from '../WorkspaceContext'

export default function SimulationPage() {
  const { userIsGuardian, href } = useWorkspace()
  if (!userIsGuardian) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6 text-gray-600">
        The simulator is only available to the household guardian.{' '}
        <Link href={href('/dashboard')} className="text-blue-600 hover:underline">Back to dashboard</Link>
      </div>
    )
  }
  return <SimulationPanel />
}
