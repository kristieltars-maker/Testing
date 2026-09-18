export const MENU_BUTTON_TEXT_PATTERN = /^\u2699\ufe0f\s*\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438/;
export const NEW_SESSION_BUTTON_TEXT_PATTERN = /^\uD83C\uDD95\s+\u041d\u043e\u0432\u0430\u044f/;
export const AGENT_MODE_BUTTON_TEXT_PATTERN = /^(📋|🛠️|💬|🔍|📝|📄|📦|🤖)\s.+\s(?:Mode|Agent)$/;
export const MODEL_BUTTON_TEXT_PATTERN = /^🧠\s(?!.*\s(?:Mode|Agent)$)[\s\S]+$/;
// Keep support for both legacy "💭" and current "💡" prefix.
export const VARIANT_BUTTON_TEXT_PATTERN = /^(💡|💭)\s.+$/;
export const CONTEXT_BUTTON_TEXT_PATTERN = /^📊(?:\s|$)/;
export const QUEUED_PROMPT_BUTTON_TEXT_PATTERN = /^❌\s\d+\.\s/;
const REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS = [
    AGENT_MODE_BUTTON_TEXT_PATTERN,
    MODEL_BUTTON_TEXT_PATTERN,
    VARIANT_BUTTON_TEXT_PATTERN,
    CONTEXT_BUTTON_TEXT_PATTERN,
    QUEUED_PROMPT_BUTTON_TEXT_PATTERN,
    NEW_SESSION_BUTTON_TEXT_PATTERN,
];
/**
 * Whether the text looks like a press on one of the reply-keyboard buttons
 * rather than a prompt the user typed.
 */
export function isReplyKeyboardButtonText(text) {
    return REPLY_KEYBOARD_BUTTON_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}
