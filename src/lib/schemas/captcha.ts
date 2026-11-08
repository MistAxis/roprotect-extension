import * as v from 'valibot';
import { CAPTCHA_EXTERNAL_MESSAGES } from '../types/constants';

const CaptchaSessionSchema = v.object({
	sessionId: v.pipe(v.string(), v.minLength(1), v.maxLength(128)),
	userId: v.pipe(v.string(), v.minLength(1), v.maxLength(32)),
	outfitNames: v.pipe(v.array(v.pipe(v.string(), v.maxLength(128))), v.maxLength(100)),
	outfitIds: v.optional(v.pipe(v.array(v.number()), v.maxLength(100))),
	inappropriateProfile: v.boolean(),
	inappropriateFriends: v.boolean(),
	inappropriateGroups: v.boolean(),
	senderTabId: v.optional(v.number()),
	timestamp: v.number()
});

// Inbound message from the roscoe-bridge content script
const CaptchaExternalMessageSchema = v.variant('type', [
	v.object({
		type: v.literal(CAPTCHA_EXTERNAL_MESSAGES.SUCCESS),
		token: v.pipe(v.string(), v.minLength(1), v.maxLength(4096)),
		session: v.pipe(v.string(), v.minLength(1), v.maxLength(128))
	}),
	v.object({
		type: v.literal(CAPTCHA_EXTERNAL_MESSAGES.ERROR),
		session: v.optional(v.pipe(v.string(), v.maxLength(128))),
		error: v.optional(v.pipe(v.string(), v.maxLength(2000)))
	})
]);

export const isCaptchaSession = (
	value: unknown
): value is v.InferOutput<typeof CaptchaSessionSchema> => v.is(CaptchaSessionSchema, value);

export const safeParseCaptchaExternalMessage = (value: unknown) =>
	v.safeParse(CaptchaExternalMessageSchema, value);
