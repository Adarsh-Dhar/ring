import type { Prisma } from "@prisma/client";
import type { Helper, Consent } from "../doorbell/config";

export const dbEnabled = !!process.env.DATABASE_URL;

export const toRow = (h: Helper, position: number) => ({
  id: h.id,
  name: h.name,
  phone: h.phone,
  emoji: h.emoji,
  consent: h.consent,
  consentAt: h.consentAt ? new Date(h.consentAt) : null,
  tokenEpoch: h.tokenEpoch ?? 1,
  position,
});

export const fromRow = (r: {
  id: string; name: string; phone: string; emoji: string; consent: string;
  consentAt: Date | null; tokenEpoch: number;
}): Helper => ({
  id: r.id,
  name: r.name,
  phone: r.phone,
  emoji: r.emoji,
  consent: r.consent as Consent,
  consentAt: r.consentAt ? r.consentAt.getTime() : undefined,
  tokenEpoch: r.tokenEpoch,
});

// Imported lazily so tests and no-DB runs never load the Prisma runtime.
export async function loadHelpers(): Promise<Helper[]> {
  const { getDb } = await import("./client");
  const rows = await getDb().helper.findMany({ orderBy: { position: 'asc' } });
  return rows.map(fromRow);
}

// The list is tiny (a handful of people), so replace it in one transaction.
export async function saveHelpers(list: Helper[]): Promise<void> {
  const { getDb } = await import("./client");
  await getDb().$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.helper.deleteMany({});
    if (list.length) await tx.helper.createMany({ data: list.map((h, i) => toRow(h, i)) });
  });
}
