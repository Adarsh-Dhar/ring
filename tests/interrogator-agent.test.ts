import { describe, it, expect } from 'vitest'
import { validQuestion, hasBannedPhrase } from '@/lib/ai/guard'

describe('interrogator agent validation', () => {
  it('validQuestion returns false for questions over 20 words', () => {
    const longQuestion = 'This is a very long question that definitely exceeds the twenty word limit that we have set for validation purposes here now'
    expect(validQuestion(longQuestion)).toBe(false)
  })

  it('validQuestion returns false for questions with banned phrases', () => {
    const bannedQuestion = 'Is home alone?'
    expect(validQuestion(bannedQuestion)).toBe(false)
  })

  it('validQuestion returns false for questions with resident name', () => {
    const nameQuestion = 'Is John home?'
    expect(validQuestion(nameQuestion, 'John')).toBe(false)
  })

  it('validQuestion returns true for valid short questions', () => {
    const validQ = 'Who are you?'
    expect(validQuestion(validQ)).toBe(true)
  })

  it('hasBannedPhrase detects scam and threat words', () => {
    expect(hasBannedPhrase('This is a scam')).toBe(true)
    expect(hasBannedPhrase('You are a liar')).toBe(true)
    expect(hasBannedPhrase('Police are coming')).toBe(true)
    expect(hasBannedPhrase('You will be arrested')).toBe(true)
    expect(hasBannedPhrase('Who are you?')).toBe(false)
  })
})
