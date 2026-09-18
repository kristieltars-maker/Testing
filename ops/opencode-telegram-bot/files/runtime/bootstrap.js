import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { getRuntimePaths } from "./paths.js";
import { getLocale, getLocaleOptions, resolveSupportedLocale, setRuntimeLocale, t, } from "../i18n/index.js";
const DEFAULT_API_URL = "http://localhost:4096";
const DEFAULT_SERVER_USERNAME = "opencode";
const FALLBACK_MODEL_PROVIDER = "opencode";
const FALLBACK_MODEL_ID = "big-pickle";
const WIZARD_ENV_KEYS = [
    "BOT_LOCALE",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_ALLOWED_USER_ID",
    "OPENCODE_API_URL",
    "OPENCODE_SERVER_USERNAME",
    "OPENCODE_SERVER_PASSWORD",
    "OPENCODE_MODEL_PROVIDER",
    "OPENCODE_MODEL_ID",
];
function isPositiveInteger(value) {
    return /^[1-9]\d*$/.test(value);
}
function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    catch {
        return false;
    }
}
export function validateRuntimeEnvValues(values) {
    if (!values.TELEGRAM_BOT_TOKEN || values.TELEGRAM_BOT_TOKEN.trim().length === 0) {
        return { isValid: false, reason: "Missing TELEGRAM_BOT_TOKEN" };
    }
    if (!String(values.TELEGRAM_ALLOWED_USER_ID || "").trim().length) {
        return { isValid: false, reason: "Missing TELEGRAM_ALLOWED_USER_ID" };
    }
    const idList = String(values.TELEGRAM_ALLOWED_USER_ID).split(/[,\s]+/);
    if (!idList.every((s) => isPositiveInteger(s))) {
        return { isValid: false, reason: "Invalid TELEGRAM_ALLOWED_USER_ID" };
    }
    if (!values.OPENCODE_MODEL_PROVIDER || values.OPENCODE_MODEL_PROVIDER.trim().length === 0) {
        return { isValid: false, reason: "Missing OPENCODE_MODEL_PROVIDER" };
    }
    if (!values.OPENCODE_MODEL_ID || values.OPENCODE_MODEL_ID.trim().length === 0) {
        return { isValid: false, reason: "Missing OPENCODE_MODEL_ID" };
    }
    const apiUrl = values.OPENCODE_API_URL?.trim();
    if (apiUrl && !isValidHttpUrl(apiUrl)) {
        return { isValid: false, reason: "Invalid OPENCODE_API_URL" };
    }
    return { isValid: true };
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeEnvLineEndings(content) {
    const lines = content.split(/\r?\n/).map((line) => line.replace(/\r$/, ""));
    while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}
function removeEnvKey(lines, key) {
    const regex = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(key)}\\s*=`);
    return lines.filter((line) => !regex.test(line));
}
function parseEnvAssignmentLine(line) {
    const match = /^(\s*#\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) {
        return null;
    }
    const key = match[2];
    const rawValue = match[3];
    if (key === undefined || rawValue === undefined) {
        return null;
    }
    return {
        key,
        rawValue,
        line,
        isCommented: typeof match[1] === "string",
    };
}
function buildTemplateKeySet(templateContent) {
    const keys = new Set();
    for (const line of normalizeEnvLineEndings(templateContent)) {
        const parsedLine = parseEnvAssignmentLine(line);
        if (parsedLine !== null) {
            keys.add(parsedLine.key);
        }
    }
    return keys;
}
function collectActiveEnvAssignments(content) {
    const assignments = new Map();
    for (const line of normalizeEnvLineEndings(content)) {
        const parsedLine = parseEnvAssignmentLine(line);
        if (parsedLine === null || parsedLine.isCommented) {
            continue;
        }
        assignments.set(parsedLine.key, parsedLine);
    }
    return assignments;
}
function collectCustomEnvAssignments(existingContent, templateKeys) {
    const customAssignments = [];
    const seenKeys = new Set();
    const lines = normalizeEnvLineEndings(existingContent);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line === undefined) {
            continue;
        }
        const parsedLine = parseEnvAssignmentLine(line);
        if (parsedLine === null || parsedLine.isCommented || templateKeys.has(parsedLine.key)) {
            continue;
        }
        if (seenKeys.has(parsedLine.key)) {
            continue;
        }
        seenKeys.add(parsedLine.key);
        customAssignments.push(parsedLine);
    }
    return customAssignments.reverse().map((assignment) => assignment.line);
}
function renderEnvAssignment(key, rawValue) {
    return `${key}=${rawValue}`;
}
function finalizeEnvContent(lines) {
    return `${lines.join("\n")}\n`;
}
function buildFlatEnvFileContent(existingContent, values) {
    let lines = normalizeEnvLineEndings(existingContent);
    const orderedUpdates = [
        ["BOT_LOCALE", values.BOT_LOCALE],
        ["TELEGRAM_BOT_TOKEN", values.TELEGRAM_BOT_TOKEN],
        ["TELEGRAM_ALLOWED_USER_ID", values.TELEGRAM_ALLOWED_USER_ID],
        ["OPENCODE_API_URL", values.OPENCODE_API_URL],
        ["OPENCODE_SERVER_USERNAME", values.OPENCODE_SERVER_USERNAME],
        ["OPENCODE_SERVER_PASSWORD", values.OPENCODE_SERVER_PASSWORD],
        ["OPENCODE_MODEL_PROVIDER", values.OPENCODE_MODEL_PROVIDER],
        ["OPENCODE_MODEL_ID", values.OPENCODE_MODEL_ID],
    ];
    for (const [key, value] of orderedUpdates) {
        lines = removeEnvKey(lines, key);
        if (value && value.trim().length > 0) {
            lines.push(`${key}=${value}`);
        }
    }
    return finalizeEnvContent(lines);
}
export function buildEnvFileContent(existingContent, values, envExampleContent) {
    if (!envExampleContent) {
        return buildFlatEnvFileContent(existingContent, values);
    }
    const templateLines = normalizeEnvLineEndings(envExampleContent);
    if (templateLines.length === 0) {
        return buildFlatEnvFileContent(existingContent, values);
    }
    const templateKeys = buildTemplateKeySet(envExampleContent);
    const existingAssignments = collectActiveEnvAssignments(existingContent);
    const wizardOverrides = new Map(WIZARD_ENV_KEYS.map((key) => [key, values[key]]));
    const renderedLines = templateLines.map((line) => {
        const parsedLine = parseEnvAssignmentLine(line);
        if (parsedLine === null) {
            return line;
        }
        if (wizardOverrides.has(parsedLine.key)) {
            const overrideValue = wizardOverrides.get(parsedLine.key);
            if (overrideValue && overrideValue.trim().length > 0) {
                return renderEnvAssignment(parsedLine.key, overrideValue);
            }
            return line;
        }
        const existingAssignment = existingAssignments.get(parsedLine.key);
        if (existingAssignment !== undefined) {
            return renderEnvAssignment(parsedLine.key, existingAssignment.rawValue);
        }
        return line;
    });
    const customAssignments = collectCustomEnvAssignments(existingContent, templateKeys);
    if (customAssignments.length > 0) {
        if (renderedLines.length > 0 && renderedLines[renderedLines.length - 1] !== "") {
            renderedLines.push("");
        }
        renderedLines.push(...customAssignments);
    }
    return finalizeEnvContent(renderedLines);
}
async function readEnvFileIfExists(filePath) {
    try {
        return await fs.readFile(filePath, "utf-8");
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
async function writeFileAtomically(filePath, content) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempFilePath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempFilePath, content, "utf-8");
    await fs.rename(tempFilePath, filePath);
}
function getEnvExamplePath() {
    const currentFilePath = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(currentFilePath), "..", "..", ".env.example");
}
async function loadEnvExampleContent() {
    try {
        return await fs.readFile(getEnvExamplePath(), "utf-8");
    }
    catch {
        return null;
    }
}
function loadModelDefaultsFromEnvExample(envExampleContent) {
    const fallbackDefaults = {
        provider: FALLBACK_MODEL_PROVIDER,
        modelId: FALLBACK_MODEL_ID,
    };
    try {
        if (!envExampleContent) {
            return fallbackDefaults;
        }
        const parsed = dotenv.parse(envExampleContent);
        const provider = parsed.OPENCODE_MODEL_PROVIDER?.trim();
        const modelId = parsed.OPENCODE_MODEL_ID?.trim();
        if (!provider || !modelId) {
            return fallbackDefaults;
        }
        return {
            provider,
            modelId,
        };
    }
    catch {
        return fallbackDefaults;
    }
}
async function askVisible(question) {
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const answer = await rl.question(question);
        return answer.trim();
    }
    finally {
        rl.close();
    }
}
async function askHidden(question) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
        });
        const maskedRl = rl;
        maskedRl._writeToOutput = (value) => {
            if (maskedRl.stdoutMuted) {
                if (value.includes("\n") || value.includes("\r")) {
                    process.stdout.write(value);
                    return;
                }
                if (value.length > 0) {
                    process.stdout.write("*");
                }
                return;
            }
            process.stdout.write(value);
        };
        maskedRl.stdoutMuted = false;
        rl.question(question, (answer) => {
            maskedRl.stdoutMuted = false;
            process.stdout.write("\n");
            rl.close();
            resolve(answer.trim());
        });
        maskedRl.stdoutMuted = true;
    });
}
async function askToken() {
    for (;;) {
        const token = await askHidden(t("runtime.wizard.ask_token"));
        if (!token) {
            process.stdout.write(t("runtime.wizard.token_required"));
            continue;
        }
        if (!token.includes(":")) {
            process.stdout.write(t("runtime.wizard.token_invalid"));
            continue;
        }
        return token;
    }
}
async function askLocale() {
    const localeOptions = getLocaleOptions();
    const defaultLocale = getLocale();
    const defaultLocaleOption = localeOptions.find((localeOption) => localeOption.code === defaultLocale) ?? localeOptions[0];
    if (!defaultLocaleOption) {
        return defaultLocale;
    }
    const optionsText = localeOptions
        .map((localeOption, index) => `${index + 1} - ${localeOption.label} (${localeOption.code})`)
        .join("\n");
    const prompt = t("runtime.wizard.ask_language", {
        options: optionsText,
        defaultLocale: `${defaultLocaleOption.label} (${defaultLocaleOption.code})`,
    });
    for (;;) {
        const answer = await askVisible(prompt);
        if (!answer) {
            return defaultLocaleOption.code;
        }
        if (/^\d+$/.test(answer)) {
            const index = Number.parseInt(answer, 10) - 1;
            if (index >= 0 && index < localeOptions.length) {
                const selectedLocale = localeOptions[index];
                if (selectedLocale) {
                    return selectedLocale.code;
                }
            }
        }
        const localeByCode = resolveSupportedLocale(answer);
        if (localeByCode) {
            return localeByCode;
        }
        process.stdout.write(t("runtime.wizard.language_invalid"));
    }
}
async function askAllowedUserId() {
    for (;;) {
        const allowedUserId = await askVisible(t("runtime.wizard.ask_user_id"));
        if (!isPositiveInteger(allowedUserId)) {
            process.stdout.write(t("runtime.wizard.user_id_invalid"));
            continue;
        }
        return allowedUserId;
    }
}
async function askApiUrl() {
    const prompt = t("runtime.wizard.ask_api_url", { defaultUrl: DEFAULT_API_URL });
    for (;;) {
        const apiUrl = await askVisible(prompt);
        if (!apiUrl) {
            return undefined;
        }
        if (!isValidHttpUrl(apiUrl)) {
            process.stdout.write(t("runtime.wizard.api_url_invalid"));
            continue;
        }
        return apiUrl;
    }
}
async function askServerUsername() {
    const prompt = t("runtime.wizard.ask_server_username", {
        defaultUsername: DEFAULT_SERVER_USERNAME,
    });
    const username = await askVisible(prompt);
    if (!username) {
        return DEFAULT_SERVER_USERNAME;
    }
    return username;
}
async function askServerPassword() {
    const password = await askHidden(t("runtime.wizard.ask_server_password"));
    if (!password) {
        return undefined;
    }
    return password;
}
async function collectWizardValues() {
    const locale = await askLocale();
    setRuntimeLocale(locale);
    const selectedLocaleOption = getLocaleOptions().find((localeOption) => localeOption.code === locale) ?? null;
    process.stdout.write("\n");
    process.stdout.write(t("runtime.wizard.language_selected", {
        language: selectedLocaleOption !== null
            ? `${selectedLocaleOption.label} (${selectedLocaleOption.code})`
            : locale,
    }));
    process.stdout.write("\n");
    process.stdout.write(t("runtime.wizard.start"));
    process.stdout.write("\n");
    const token = await askToken();
    const allowedUserId = await askAllowedUserId();
    const apiUrl = await askApiUrl();
    const serverUsername = await askServerUsername();
    const serverPassword = await askServerPassword();
    process.stdout.write("\n");
    return {
        locale,
        token,
        allowedUserId,
        apiUrl,
        serverUsername,
        serverPassword,
    };
}
function ensureInteractiveTty() {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error(t("runtime.wizard.tty_required"));
    }
}
async function validateExistingEnv(envFilePath) {
    const content = await readEnvFileIfExists(envFilePath);
    const effectiveValues = content === null ? {} : dotenv.parse(content);
    for (const key of WIZARD_ENV_KEYS) {
        const processValue = process.env[key];
        if (processValue !== undefined) {
            effectiveValues[key] = processValue;
        }
    }
    return validateRuntimeEnvValues(effectiveValues);
}
async function runWizardAndPersist(runtimePaths) {
    ensureInteractiveTty();
    const [existingContent, envExampleContent, wizardValues] = await Promise.all([
        readEnvFileIfExists(runtimePaths.envFilePath),
        loadEnvExampleContent(),
        collectWizardValues(),
    ]);
    const modelDefaults = loadModelDefaultsFromEnvExample(envExampleContent);
    const existingParsed = existingContent ? dotenv.parse(existingContent) : {};
    const provider = existingParsed.OPENCODE_MODEL_PROVIDER || modelDefaults.provider;
    const modelId = existingParsed.OPENCODE_MODEL_ID || modelDefaults.modelId;
    const envValues = {
        BOT_LOCALE: wizardValues.locale,
        TELEGRAM_BOT_TOKEN: wizardValues.token,
        TELEGRAM_ALLOWED_USER_ID: wizardValues.allowedUserId,
        OPENCODE_API_URL: wizardValues.apiUrl,
        OPENCODE_SERVER_USERNAME: wizardValues.serverUsername,
        OPENCODE_SERVER_PASSWORD: wizardValues.serverPassword,
        OPENCODE_MODEL_PROVIDER: provider,
        OPENCODE_MODEL_ID: modelId,
    };
    const envContent = buildEnvFileContent(existingContent ?? "", envValues, envExampleContent);
    await writeFileAtomically(runtimePaths.envFilePath, envContent);
    process.stdout.write(t("runtime.wizard.saved", {
        envPath: runtimePaths.envFilePath,
    }));
}
export async function ensureRuntimeConfigForStart() {
    const runtimePaths = getRuntimePaths();
    if (runtimePaths.mode !== "installed") {
        return;
    }
    const validationResult = await validateExistingEnv(runtimePaths.envFilePath);
    if (validationResult.isValid) {
        return;
    }
    process.stdout.write(t("runtime.wizard.not_configured_starting"));
    await runWizardAndPersist(runtimePaths);
}
export async function runConfigWizardCommand() {
    const runtimePaths = getRuntimePaths();
    await runWizardAndPersist(runtimePaths);
}
