'use client'
import { createContext, useContext } from 'react'

export interface WorkspaceData {
  id: string
  residentName: string
  role: string
  requireResidentOk: boolean
  plannedMode: string
  hasHelperMembership: boolean
  user: { name: string | null; email: string | null } | null
}

export interface WorkspaceCtx {
  workspaceId: string
  workspace: WorkspaceData
  role: 'resident' | 'helper'
  isResidentView: boolean
  userIsGuardian: boolean
  /** Build a workspace URL that keeps the current role, e.g. href('/calendar'). */
  href: (subPath?: string) => string
}

const Ctx = createContext<WorkspaceCtx | null>(null)
export const WorkspaceProvider = Ctx.Provider

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace must be used inside the workspace layout')
  return v
}
