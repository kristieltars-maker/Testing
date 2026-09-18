import { InlineKeyboard } from "grammy";
import { replyWithInlineMenu } from "./inline-menu.js";
export const HUB_CALLBACK = {
    newSession: "hub:new",
    project: "hub:project",
    agent: "hub:agent",
    model: "hub:model",
    variant: "hub:variant",
    context: "hub:context",
    bot: "hub:bot",
};
var LBL = {
    newSession: "\uD83C\uDD95 \u041d\u043e\u0432\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f",
    project: "\uD83D\uDCC1 \u041f\u0440\u043e\u0435\u043a\u0442",
    agent: "\uD83E\uDD16 \u0410\u0433\u0435\u043d\u0442",
    model: "\uD83E\uDDE0 \u041c\u043e\u0434\u0435\u043b\u044c",
    variant: "\uD83D\uDCA1 \u0412\u0430\u0440\u0438\u0430\u043d\u0442",
    context: "\uD83D\uDCCA \u041a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
    bot: "\u2699\uFE0F \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0431\u043e\u0442\u0430",
    title: "\u2699\uFE0F \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438",
};
export function buildHubKeyboard() {
    return new InlineKeyboard()
        .text(LBL.project, HUB_CALLBACK.project)
        .row()
        .text(LBL.agent, HUB_CALLBACK.agent)
        .row()
        .text(LBL.model, HUB_CALLBACK.model)
        .row()
        .text(LBL.variant, HUB_CALLBACK.variant)
        .row()
        .text(LBL.context, HUB_CALLBACK.context)
        .row()
        .text(LBL.bot, HUB_CALLBACK.bot);
}
export async function showHubMenu(ctx) {
    await replyWithInlineMenu(ctx, {
        menuKind: "settings",
        text: LBL.title,
        keyboard: buildHubKeyboard(),
    });
}
