import type { PosComplaintCategory } from '@/generated/prisma/client';
import type { AnyDb } from '@/server/data/tenant-db';

/**
 * The two reads and writes the AI package needs on complaints, and nothing else. The text it hands out is exactly the body,
 * the category and the id: never a contact name or phone, a table or an order. What it writes is the four AI columns only;
 * the guest's own text and category, the status and the notes stay as they were.
 */

export const LABEL_BATCH = 20;
export const AI_SUMMARY_MAX = 200;

export interface UnlabeledComplaint {
  id: string;
  body: string;
  category: PosComplaintCategory | null;
}

/** The newest complaints the AI has not labeled yet, at most `take`. */
export async function listUnlabeledComplaintTexts(db: AnyDb, restaurantId: string, take = LABEL_BATCH): Promise<UnlabeledComplaint[]> {
  return db.posComplaint.findMany({
    where: { restaurantId, aiLabeledAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: { id: true, body: true, category: true },
  });
}

export async function countUnlabeledComplaints(db: AnyDb, restaurantId: string): Promise<number> {
  return db.posComplaint.count({ where: { restaurantId, aiLabeledAt: null } });
}

export interface ComplaintAiLabel {
  complaintId: string;
  category: PosComplaintCategory;
  summary: string | null;
  language: string;
}

/** Stamps the labels on the restaurant's own complaints; an id of another restaurant, or one already labeled, is skipped. */
export async function setComplaintAiLabels(db: AnyDb, restaurantId: string, labels: readonly ComplaintAiLabel[], now = new Date()): Promise<{ count: number }> {
  let count = 0;
  for (const label of labels) {
    const done = await db.posComplaint.updateMany({
      where: { id: label.complaintId, restaurantId, aiLabeledAt: null },
      data: { aiCategory: label.category, aiSummary: label.summary === null ? null : [...label.summary].slice(0, AI_SUMMARY_MAX).join(''), languageGuess: label.language, aiLabeledAt: now },
    });
    count += done.count;
  }
  return { count };
}
