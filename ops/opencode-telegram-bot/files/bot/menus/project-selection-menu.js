import { getProjectDisplayName } from "../../app/services/project-display-name.js";
import { InlineKeyboard } from "grammy";
import { getGitWorktreeContext } from "../../app/services/worktree-service.js";
import { t } from "../../i18n/index.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config.js";
const MAX_INLINE_BUTTON_LABEL_LENGTH = 64;
export const PROJECT_PAGE_CALLBACK_PREFIX = "projects:page:";
function formatProjectButtonLabel(label, isActive) {
    const prefix = isActive ? "✅ " : "";
    const availableLength = MAX_INLINE_BUTTON_LABEL_LENGTH - prefix.length;
    if (label.length <= availableLength) {
        return `${prefix}${label}`;
    }
    return `${prefix}${label.slice(0, Math.max(0, availableLength - 3))}...`;
}
export function getProjectFolderName(worktree) {
    const friendly = getProjectDisplayName(worktree);
    if (friendly) {
        return friendly;
    }
    const normalized = worktree.replace(/[\\/]+$/g, "");
    if (!normalized) {
        return worktree;
    }
    const segments = normalized.split(/[\\/]/).filter(Boolean);
    return segments.at(-1) ?? normalized;
}
export function buildProjectButtonLabel(index, worktree) {
    const folderName = getProjectFolderName(worktree);
    if (getProjectDisplayName(worktree)) {
        return `${index + 1}. ${folderName}`;
    }
    return `${index + 1}. ${folderName} [${worktree}]`;
}
export function parseProjectPageCallback(data) {
    if (!data.startsWith(PROJECT_PAGE_CALLBACK_PREFIX)) {
        return null;
    }
    const rawPage = data.slice(PROJECT_PAGE_CALLBACK_PREFIX.length);
    if (!/^\d+$/.test(rawPage)) {
        return null;
    }
    return Number.parseInt(rawPage, 10);
}
export function calculateProjectsPaginationRange(totalProjects, page, pageSize) {
    const safePageSize = Math.max(1, pageSize);
    const totalPages = Math.max(1, Math.ceil(totalProjects / safePageSize));
    const normalizedPage = Math.min(Math.max(0, page), totalPages - 1);
    const startIndex = normalizedPage * safePageSize;
    const endIndex = Math.min(startIndex + safePageSize, totalProjects);
    return {
        page: normalizedPage,
        totalPages,
        startIndex,
        endIndex,
    };
}
function buildProjectsMenuText(currentProjectName, page, totalPages) {
    const baseText = currentProjectName
        ? t("projects.select_with_current", {
            project: currentProjectName,
        })
        : t("projects.select");
    if (totalPages <= 1) {
        return baseText;
    }
    return `${baseText}\n\n${t("projects.page_indicator", {
        current: String(page + 1),
        total: String(totalPages),
    })}`;
}
function worktreeKey(worktree) {
    return process.platform === "win32" ? worktree.toLowerCase() : worktree;
}
async function getActiveProjectWorktree() {
    const currentProject = getCurrentProject();
    if (!currentProject) {
        return null;
    }
    try {
        const worktreeContext = await getGitWorktreeContext(currentProject.worktree);
        if (worktreeContext) {
            return worktreeContext.mainProjectPath;
        }
    }
    catch (error) {
        logger.debug("[Projects] Could not resolve active git worktree metadata:", error);
    }
    return currentProject.worktree;
}
async function buildProjectsKeyboard(projects, page) {
    const keyboard = new InlineKeyboard();
    const currentProject = getCurrentProject();
    const activeProjectWorktree = await getActiveProjectWorktree();
    const pageSize = config.bot.projectsListLimit;
    const { page: normalizedPage, totalPages, startIndex, endIndex, } = calculateProjectsPaginationRange(projects.length, page, pageSize);
    projects.slice(startIndex, endIndex).forEach((project, index) => {
        const isActive = currentProject &&
            (project.id === currentProject.id ||
                project.worktree === currentProject.worktree ||
                (activeProjectWorktree !== null &&
                    worktreeKey(project.worktree) === worktreeKey(activeProjectWorktree)));
        const label = buildProjectButtonLabel(startIndex + index, project.worktree);
        const labelWithCheck = formatProjectButtonLabel(label, Boolean(isActive));
        keyboard.text(labelWithCheck, `project:${project.id}`).row();
    });
    if (totalPages > 1) {
        if (normalizedPage > 0) {
            keyboard.text(t("projects.prev_page"), `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage - 1}`);
        }
        if (normalizedPage < totalPages - 1) {
            keyboard.text(t("projects.next_page"), `${PROJECT_PAGE_CALLBACK_PREFIX}${normalizedPage + 1}`);
        }
    }
    return keyboard;
}
export async function buildProjectsMenuView(projects, page) {
    const currentProject = getCurrentProject();
    const pageSize = config.bot.projectsListLimit;
    const { page: normalizedPage, totalPages } = calculateProjectsPaginationRange(projects.length, page, pageSize);
    const currentProjectName = getProjectDisplayName(currentProject?.worktree) || currentProject?.name || currentProject?.worktree || null;
    return {
        text: buildProjectsMenuText(currentProjectName, normalizedPage, totalPages),
        keyboard: await buildProjectsKeyboard(projects, normalizedPage),
    };
}
