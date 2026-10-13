import { emailString, trimmedString, v } from "@/lib/validation";
import { newPasswordSchema, passwordVerificationSchema } from "@/schemas/password.schema";

// Mobile-app account REST (AutoJs6 account module), contract table A of
// AutoJs6-noOperit-account/docs/账号模块开发文档.md. Wire format both ends compile against.

/** Profile shape every auth response carries. `dateExpired` is the AutoJsPro semantics name:
 * membership expiry read off the user's personal team, null until P2 grants membership. */
export const mobileProfileSchema = v.object({
  accountName: v.string(),
  email: v.nullable(v.string()),
  nickname: v.nullable(v.string()),
  avatar: v.nullable(v.string()),
  dateExpired: v.nullable(v.string()),
  emailVerified: v.boolean(),
});

export const mobileRegisterSchema = v.object({
  email: emailString(),
  password: newPasswordSchema,
  nickname: v.optional(trimmedString({ min: 1, max: 64 })),
});

export const mobileLoginSchema = v.object({
  email: emailString(),
  password: passwordVerificationSchema,
  deviceId: v.pipe(v.string(), v.minLength(8), v.maxLength(128)),
});

export const mobileChangePasswordSchema = v.object({
  oldPassword: passwordVerificationSchema,
  newPassword: newPasswordSchema,
});

export const mobileRegisterResponseSchema = v.object({
  token: v.string(),
  profile: mobileProfileSchema,
});

export const mobileLoginResponseSchema = mobileRegisterResponseSchema;

export const mobileMeResponseSchema = v.object({
  profile: mobileProfileSchema,
});

export const mobileBindingsSchema = v.array(
  v.object({
    provider: v.string(),
    boundAt: v.string(),
    displayName: v.nullable(v.string()),
  }),
);

export const mobileUnbindParamSchema = v.object({
  provider: v.picklist(["email", "github", "wechat", "dingtalk"]),
});

export type MobileProfile = v.InferOutput<typeof mobileProfileSchema>;
