export function distance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s)
}
