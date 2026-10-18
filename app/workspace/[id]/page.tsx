import { redirect } from 'next/navigation'

export default async function WorkspaceIndex({ params, searchParams }: {
  params: Promise<{ id: string }> | { id: string }
  searchParams: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}) {
  const { id } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v)
  }
  const section = qs.has('calendar') || qs.has('error') ? 'calendar' : 'dashboard'
  const q = qs.toString()
  redirect(`/workspace/${id}/${section}${q ? `?${q}` : ''}`)
}
