const PROJECT_DISPLAY_NAMES = {
    "/srv/testing-bots": "\u042d\u043a\u043e\u0441\u0438\u0441\u0442\u0435\u043c\u0430 \u0411\u043e\u0442-\u0430\u0442\u0435\u043b\u044c\u0435",
};
export function getProjectDisplayName(worktree) {
    if (!worktree) {
        return null;
    }
    const normalized = String(worktree).replace(/[\\/]+$/g, "");
    return PROJECT_DISPLAY_NAMES[normalized] || null;
}
