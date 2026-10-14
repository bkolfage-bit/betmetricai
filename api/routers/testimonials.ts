/**
 * Testimonials router — customer reviews with an admin moderation workflow.
 *
 * Integrity rules (per spec):
 *  - The public ONLY ever sees reviews an admin has explicitly approved.
 *  - The rating and wording shown are exactly what the customer submitted —
 *    moderation can approve/reject/feature/verify but NEVER edits the text
 *    or the star rating.
 *  - The 26 illustrative homepage examples are frontend-only sample copy and
 *    are never inserted here; real reviews replace them, never mix with
 *    them as if they were verified customers.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { adminQuery, authedQuery, createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { testimonials, users } from "@db/schema";

export const testimonialsRouter = createRouter({
  /** Approved reviews for the homepage carousel — featured first. */
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: testimonials.id,
        displayName: testimonials.displayName,
        rating: testimonials.rating,
        text: testimonials.text,
        verified: testimonials.verified,
        createdAt: testimonials.createdAt,
      })
      .from(testimonials)
      .where(eq(testimonials.status, "approved"))
      .orderBy(desc(testimonials.featured), desc(testimonials.createdAt))
      .limit(50);
    return { reviews: rows };
  }),

  /** Authenticated customer review submission — lands in the pending queue. */
  submit: authedQuery
    .input(
      z.object({
        displayName: z.string().trim().min(2).max(64),
        rating: z.number().int().min(1).max(5),
        text: z.string().trim().min(10).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const pending = await db
        .select({ id: testimonials.id })
        .from(testimonials)
        .where(eq(testimonials.userId, ctx.user.id))
        .limit(1);
      if (pending.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You've already submitted a review — it's in the moderation queue.",
        });
      }
      await db.insert(testimonials).values({
        userId: ctx.user.id,
        displayName: input.displayName,
        rating: input.rating,
        text: input.text,
      });
      return { ok: true };
    }),

  /** My own submission (so the form can show its moderation state). */
  mine: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.userId, ctx.user.id))
      .orderBy(desc(testimonials.createdAt))
      .limit(1);
    return { review: rows[0] ?? null };
  }),

  /** Admin: full moderation queue, pending first. */
  adminList: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: testimonials.id,
        userId: testimonials.userId,
        displayName: testimonials.displayName,
        rating: testimonials.rating,
        text: testimonials.text,
        status: testimonials.status,
        verified: testimonials.verified,
        featured: testimonials.featured,
        createdAt: testimonials.createdAt,
        email: users.email,
      })
      .from(testimonials)
      .leftJoin(users, eq(testimonials.userId, users.id))
      .orderBy(desc(testimonials.createdAt))
      .limit(200);
    return { reviews: rows };
  }),

  /** Admin moderation — approve/reject/feature/verify. Text and rating
   *  are never editable here by design. */
  moderate: adminQuery
    .input(
      z.object({
        id: z.number(),
        action: z.enum(["approve", "reject", "feature", "unfeature", "verify", "unverify"]),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const patch =
        input.action === "approve"
          ? { status: "approved" as const }
          : input.action === "reject"
            ? { status: "rejected" as const }
            : input.action === "feature"
              ? { featured: 1 }
              : input.action === "unfeature"
                ? { featured: 0 }
                : input.action === "verify"
                  ? { verified: 1 }
                  : { verified: 0 };
      await db.update(testimonials).set(patch).where(eq(testimonials.id, input.id));
      return { ok: true };
    }),
});
