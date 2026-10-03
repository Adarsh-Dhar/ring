export const PURPOSES = {
  doctor:   { icon: '🩺', label: 'Doctor' },
  delivery: { icon: '📦', label: 'Delivery' },
  family:   { icon: '👪', label: 'Family' },
  carer:    { icon: '🧑‍⚕️', label: 'Carer' },
  other:    { icon: '👤', label: 'Visit' },
} as const

export type Purpose = keyof typeof PURPOSES
export const PURPOSE_KEYS = Object.keys(PURPOSES) as [Purpose, ...Purpose[]]
