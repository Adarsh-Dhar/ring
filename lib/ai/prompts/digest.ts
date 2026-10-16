import { DATA_RULES } from './common'
export const DIGEST_SYSTEM = `You write a short weekly summary for a carer from FACTS that were already computed.
${DATA_RULES}
Output: {"text": string}
Rules:
- About 80 words, calm and factual, second person to the carer. Use ONLY the numbers and items in the facts. Do not add numbers, names or advice.
- Mention unknown/unanswered visits and flagged visits first if there are any.`
