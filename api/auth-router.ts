import * as cookie from "cookie";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Session } from "@contracts/constants";
import { users } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { hashPassword, verifyPassword } from "./auth/password";
import { signSessionToken } from "./kimi/session";
import { env } from "./lib/env";

/** Standalone accounts live in the same users table with a local: unionId. */
const localUnionId = (email: string) => `local:${email.toLowerCase()}`;

async function issueSession(
  ctx: { req: Request; resHeaders: Headers },
  unionId: string,
) {
  const token = await signSessionToken({ unionId, clientId: env.appId });
  const opts = getSessionCookieOptions(ctx.req.headers);
  ctx.resHeaders.append(
    "set-cookie",
    cookie.serialize(Session.cookieName, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: Session.maxAgeMs / 1000,
    }),
  );
}

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export const authRouter = createRouter({
  me: authedQuery.query((opts) => {
    const { passwordHash, ...user } = opts.ctx.user;
    return { ...user, hasPassword: passwordHash != null };
  }),

  /** Standalone registration — email + password, no Kimi involved. */
  register: publicQuery
    .input(credentials.extend({ name: z.string().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const unionId = localUnionId(input.email);
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.unionId, unionId))
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An account with this email already exists. Sign in instead.",
        });
      }
      const passwordHash = await hashPassword(input.password);
      await db.insert(users).values({
        unionId,
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: "user",
        plan: "free",
        lastSignInAt: new Date(),
      });
      await issueSession(ctx, unionId);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.unionId, unionId))
        .limit(1);
      const { passwordHash: _ph, ...safe } = user;
      return { ...safe, hasPassword: true };
    }),

  /** Standalone login — email + password. */
  login: publicQuery.input(credentials).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const unionId = localUnionId(input.email);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.unionId, unionId))
      .limit(1);
    const ok = user && (await verifyPassword(input.password, user.passwordHash));
    if (!ok) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "Invalid email or password.",
      });
    }
    await db
      .update(users)
      .set({ lastSignInAt: new Date() })
      .where(eq(users.id, user.id));
    await issueSession(ctx, unionId);
    const { passwordHash: _ph, ...safe } = user;
    return { ...safe, hasPassword: true };
  }),

  /** Signed-in user changes their own password. */
  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z
          .string()
          .min(8, "Password must be at least 8 characters")
          .max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);
      if (!user?.passwordHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This account has no password (OAuth account).",
        });
      }
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect.",
        });
      }
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(input.newPassword) })
        .where(eq(users.id, user.id));
      return { ok: true };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
