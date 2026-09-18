import { getProjects } from "../../app/services/project-service.js";
import { showAgentSelectionMenu } from "../menus/agent-selection-menu.js";
import { showModelSelectionMenu } from "../menus/model-selection-menu.js";
import { showVariantSelectionMenu } from "../menus/variant-selection-menu.js";
import { handleContextButtonPress } from "../menus/context-control-menu.js";
import { buildSettingsMenuView } from "../menus/settings-menu.js";
import { buildProjectsMenuView } from "../menus/project-selection-menu.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { HUB_CALLBACK } from "../menus/hub-menu.js";
import { newCommand } from "../commands/new-command.js";
import { logger } from "../../utils/logger.js";
export async function handleHubCallback(ctx, deps) {
    const data = ctx.callbackQuery?.data || "";
    await ctx.answerCallbackQuery().catch(() => { });
    try {
        if (data === HUB_CALLBACK.newSession) {
            await ctx.deleteMessage().catch(() => { });
            await newCommand(ctx, {
                bot: deps.bot,
                ensureEventSubscription: deps.ensureEventSubscription,
            });
            return true;
        }
        if (data === HUB_CALLBACK.project) {
            const projects = await getProjects();
            const { text, keyboard } = await buildProjectsMenuView(projects, 0);
            await ctx.deleteMessage().catch(() => { });
            await replyWithInlineMenu(ctx, { menuKind: "project", text, keyboard });
            return true;
        }
        if (data === HUB_CALLBACK.agent) {
            await ctx.deleteMessage().catch(() => { });
            await showAgentSelectionMenu(ctx);
            return true;
        }
        if (data === HUB_CALLBACK.model) {
            await ctx.deleteMessage().catch(() => { });
            await showModelSelectionMenu(ctx);
            return true;
        }
        if (data === HUB_CALLBACK.variant) {
            await ctx.deleteMessage().catch(() => { });
            await showVariantSelectionMenu(ctx);
            return true;
        }
        if (data === HUB_CALLBACK.context) {
            await ctx.deleteMessage().catch(() => { });
            await handleContextButtonPress(ctx);
            return true;
        }
        if (data === HUB_CALLBACK.bot) {
            const { text, keyboard } = buildSettingsMenuView();
            await ctx.deleteMessage().catch(() => { });
            await replyWithInlineMenu(ctx, { menuKind: "settings", text, keyboard });
            return true;
        }
    }
    catch (err) {
        logger.error("[Hub] Error handling hub callback:", err);
    }
    return true;
}
