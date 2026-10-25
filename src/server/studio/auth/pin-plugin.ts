import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { PIN_PATTERN } from '@/server/domain/pos/pin';
import { posLanding } from '@/server/domain/pos/permissions';
import { posGate, resolvePosActor } from '@/server/pos/actor';
import { readDeviceToken } from '@/server/pos/device-cookie';
import { DeviceLimitError, PinLockedError, PinRefusedError, resolveDevice, verifyPin } from '@/server/pos/pin';
import { requestMeta } from '@/server/studio/framework/action';

export const pinSignInBody = z.object({ staffId: z.string().min(1).max(64), pin: z.string().regex(PIN_PATTERN) });

/**
 * Quick sign-in on a registered shared device: the person is chosen from the device's own restaurant, the PIN is checked
 * by `verifyPin` (limits, lock, audit), and the answer is an ordinary Studio session for that person in place of whoever
 * was signed in before. Reached only through `/api/pos/pin/sign-in`; the Studio's public auth allowlist does not list it.
 */
export function pinSignIn(prisma: PrismaClient) {
  return {
    id: 'pos-pin-sign-in',
    endpoints: {
      pinSignIn: createAuthEndpoint('/pos-pin/sign-in', { method: 'POST', body: pinSignInBody }, async (ctx) => {
        const headers = ctx.headers ?? new Headers();
        const device = await resolveDevice(prisma, readDeviceToken(headers));
        if (!device) throw new APIError('FORBIDDEN', { message: 'Unknown device', code: 'deviceUnknown' });
        if (!(await posGate(prisma, device.restaurantId)).open) throw new APIError('FORBIDDEN', { message: 'The till is closed', code: 'tillClosed' });

        let verified;
        try {
          verified = await verifyPin(prisma, { device, staffId: ctx.body.staffId, pin: ctx.body.pin, meta: requestMeta(headers) });
        } catch (error) {
          if (error instanceof PinLockedError) throw new APIError('TOO_MANY_REQUESTS', { message: 'Locked', code: 'pinLocked', retryAt: error.until.toISOString() });
          if (error instanceof DeviceLimitError) throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many attempts', code: 'deviceLimit' });
          if (error instanceof PinRefusedError) throw new APIError('UNAUTHORIZED', { message: 'Refused', code: 'pinRefused' });
          throw error;
        }

        const actor = await resolvePosActor(prisma, verified.userId, device.restaurantId);
        const user = await ctx.context.internalAdapter.findUserById(verified.userId);
        if (!actor || !user) throw new APIError('UNAUTHORIZED', { message: 'Refused', code: 'pinRefused' });

        // The person who was signed in on this device is signed out first: one session, the new person's.
        const previous = await getSessionFromCtx(ctx).catch(() => null);
        if (previous) await ctx.context.internalAdapter.deleteSession(previous.session.token);

        const session = await ctx.context.internalAdapter.createSession(user.id, false);
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ landing: posLanding(actor.role) });
      }),
    },
  } satisfies BetterAuthPlugin;
}
