import type { Context, Middleware } from "telegraf";

export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface AuthorizeResult {
  allow: boolean;
  reason:
    | "owner_private"
    | "unauthorized_private_reject"
    | "unauthorized_chat_type_reject"
    | "no_from";
}

export interface AuthContextShape {
  from: { id: number; is_bot?: boolean | undefined; username?: string | undefined } | undefined;
  chat: { id: number; type: string };
}

export function authorize(ctx: AuthContextShape, ownerId: number): AuthorizeResult {
  const from = ctx.from;
  if (!from) {
    return { allow: false, reason: "no_from" };
  }
  if (ctx.chat.type !== "private") {
    return { allow: false, reason: "unauthorized_chat_type_reject" };
  }
  return from.id === ownerId
    ? { allow: true, reason: "owner_private" }
    : { allow: false, reason: "unauthorized_private_reject" };
}

export function ownerOnly(ownerId: number): Middleware<Context> {
  return async (ctx, next) => {
    const chat = ctx.chat;
    if (!chat) {
      return;
    }
    const shape: AuthContextShape = {
      from: ctx.from ? { id: ctx.from.id, is_bot: ctx.from.is_bot, username: ctx.from.username } : undefined,
      chat: { id: chat.id, type: chat.type },
    };
    const result = authorize(shape, ownerId);
    if (!result.allow) {
      await ctx.reply("Not authorized.");
      return;
    }
    return next();
  };
}
