'use client'

import { useCallback, useEffect, useState } from 'react'

/** Keeps the guardian PIN for this browser tab session. Only needed when SETUP_PIN is set on the server. */
export function usePin() {
  const [pin, setPinState] = useState('')

  useEffect(() => {
    setPinState(sessionStorage.getItem('setupPin') || '')
  }, [])

  const setPin = useCallback((p: string) => {
    sessionStorage.setItem('setupPin', p)
    setPinState(p)
  }, [])

  return { pin, setPin }
}
