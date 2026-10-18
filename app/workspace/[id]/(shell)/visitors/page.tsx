'use client'
import Link from 'next/link'
import { useWorkspace } from '../WorkspaceContext'

export default function VisitorsPage() {
  const { isResidentView, href } = useWorkspace()
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Visitor Management</h2>
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-gray-600 mb-4">
          {isResidentView
            ? 'Review and approve visitor passes created by helpers.'
            : 'Create visitor passes for one-time or recurring visits. The resident will need to approve them.'}
        </p>
        <Link href={href('/add-visitor')} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
          Add Visitor Pass
        </Link>
      </div>
    </div>
  )
}
