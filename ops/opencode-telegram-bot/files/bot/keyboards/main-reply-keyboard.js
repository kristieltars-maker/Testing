import { Keyboard } from "grammy";
import { getAgentButtonLabel } from "../../app/types/agent.js";
import { formatModelForButton } from "../../app/types/model.js";
import { t } from "../../i18n/index.js";
/**
 * Format token count for display (e.g., 150000 -> "150K", 1500000 -> "1.5M")
 */
function formatTokenCount(count) {
    if (count >= 1000000) {
        return `${(count / 1000000).toFixed(1)}M`;
    }
    else if (count >= 1000) {
        return `${Math.round(count / 1000)}K`;
    }
    return count.toString();
}
/**
 * Format context information for button
 */
function formatContextForButton(contextInfo) {
    const used = formatTokenCount(contextInfo.tokensUsed);
    const limit = formatTokenCount(contextInfo.tokensLimit);
    const percent = Math.round((contextInfo.tokensUsed / contextInfo.tokensLimit) * 100);
    return t("keyboard.context", { used, limit, percent });
}
/**
 * Create Reply Keyboard with agent, model, variant, and context indicators
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @param currentModel Current model info
 * @param contextInfo Optional context information (tokens used/limit)
 * @param variantName Optional variant display name (e.g., "💭 Default")
 * @param queuedPromptLabels Optional queued prompt labels, one row each above the fixed grid
 * @returns Reply Keyboard with queued prompts on top, agent and context in the next row,
 *          model and variant in the last row
 */
export function createMainKeyboard(currentAgent, currentModel, contextInfo, variantName, queuedPromptLabels = []) {
    const keyboard = new Keyboard();
    // Queued prompts stay on top, one per row
    for (const label of queuedPromptLabels) {
        keyboard.text(label).row();
    }
    keyboard.text("\uD83C\uDD95 \u041d\u043e\u0432\u0430\u044f \u0441\u0435\u0441\u0441\u0438\u044f \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f").row();
    keyboard.text("\uD83D\uDCC2 \u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0441\u0435\u0441\u0441\u0438\u044e").row();
    keyboard.text("\u2699\ufe0f \u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438").row();
    return keyboard.resized().persistent();
}
/**
 * Create Reply Keyboard with agent indicator
 * @param currentAgent Current agent name (e.g., "build", "plan")
 * @returns Reply Keyboard with single button showing current agent
 * @deprecated Use createMainKeyboard instead
 */
export function createAgentKeyboard(currentAgent) {
    const keyboard = new Keyboard();
    const displayName = getAgentButtonLabel(currentAgent);
    // Single button with current agent
    keyboard.text(displayName).row();
    return keyboard.resized().persistent();
}
/**
 * Remove Reply Keyboard (for cleanup)
 */
export function removeKeyboard() {
    return { remove_keyboard: true };
}
