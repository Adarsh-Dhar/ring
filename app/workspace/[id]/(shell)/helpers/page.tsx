'use client'
import Link from 'next/link'
import { useWorkspace } from '../WorkspaceContext'

export default function HelpersPage() {
  const { href } = useWorkspace()
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Helper Management</h2>
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-gray-600 mb-4">
          Add trusted family members or friends as helpers. They can create visitor passes and receive doorbell alerts.
        </p>
        <Link href={href('/add-helper')} className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors">
          Add Helper
        </Link>
      </div>
    </div>
  )
}
