import Link from 'next/link'

const links = [
  { href: '/sim', icon: '🧪', title: 'Simulator', sub: 'Ring the doorbell, break things' },
  { href: '/resident', icon: '🏠', title: 'Resident screen', sub: 'What the resident sees' },
  { href: '/helper?as=h1', icon: '🧑‍🤝‍🧑', title: 'Helper screen', sub: 'What the helper sees' },
]

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold mb-4">Doorbell Helper</h1>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="w-full max-w-sm rounded-2xl bg-slate-800 hover:bg-slate-700 p-5 flex items-center gap-4"
        >
          <span className="text-4xl">{l.icon}</span>
          <span>
            <span className="block text-lg font-semibold">{l.title}</span>
            <span className="block text-sm text-slate-400">{l.sub}</span>
          </span>
        </Link>
      ))}
    </main>
  )
}
