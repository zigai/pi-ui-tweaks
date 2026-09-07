/**
 * Vendored runtime-module loader for Pi internals.
 *
 * Copied from @zigai/pi-extension-internals@0.1.2 (MIT, © zigai) and inlined
 * so pi-tree does not depend on a workspace-resolved internals version, which
 * npm lockfiles can shadow with an older nested copy.
 *
 * @author mystery4f
 */
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export type PiInternalModuleLoadOptions<T> = {
    readonly scope: string;
    readonly feature: string;
    readonly parse: (module: unknown) => T | undefined;
};

function isCodingAgentPackageDirectory(directory: string): boolean {
    const dependencyDirectory = getPackageDir();
    return (
        basename(directory) === basename(dependencyDirectory) &&
        basename(dirname(directory)) === basename(dirname(dependencyDirectory))
    );
}

function findEntrypointPackageDirectory(): string | undefined {
    if (process.env.PI_CODING_AGENT !== "true") return undefined;
    const entrypoint = process.argv[1];
    if (entrypoint === undefined || entrypoint.length === 0) return undefined;

    let directory = dirname(realpathSync(entrypoint));
    while (true) {
        if (
            isCodingAgentPackageDirectory(directory) &&
            existsSync(join(directory, "package.json"))
        ) {
            return directory;
        }
        const parent = dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
    }
}

function resolveRunningPiPackageDirectory(): string {
    // PI_PACKAGE_DIR is Pi's explicit package-root override and must win over
    // entrypoint inference. getPackageDir() already validates and normalizes it.
    if (process.env.PI_PACKAGE_DIR !== undefined) return getPackageDir();
    return findEntrypointPackageDirectory() ?? getPackageDir();
}

const ENTRYPOINT_IMPORT_PATTERN = /(?:\bfrom\s*|(?:^|;)\s*import\s*)["'](\.\/[^"']+\.js)["']/g;

function resolvePiEntrypointModuleUrls(): string[] {
    if (process.env.PI_CODING_AGENT !== "true") return [];
    const entrypoint = process.argv[1];
    if (entrypoint === undefined || entrypoint.length === 0 || !existsSync(entrypoint)) return [];

    const packageDirectory = resolve(resolveRunningPiPackageDirectory());
    const entrypointPath = realpathSync(entrypoint);
    const entrypointWithinPackage = relative(packageDirectory, entrypointPath);
    if (
        entrypointWithinPackage === ".." ||
        entrypointWithinPackage.startsWith(`..${sep}`) ||
        isAbsolute(entrypointWithinPackage)
    ) {
        return [];
    }

    const source = readFileSync(entrypointPath, "utf8");
    const moduleUrls: string[] = [];
    for (const match of source.matchAll(ENTRYPOINT_IMPORT_PATTERN)) {
        const specifier = match[1];
        if (specifier === undefined) continue;
        const modulePath = resolve(dirname(entrypointPath), specifier);
        const moduleWithinPackage = relative(packageDirectory, modulePath);
        if (
            moduleWithinPackage === ".." ||
            moduleWithinPackage.startsWith(`..${sep}`) ||
            isAbsolute(moduleWithinPackage)
        ) {
            continue;
        }
        moduleUrls.push(pathToFileURL(modulePath).href);
    }
    return [...new Set(moduleUrls)];
}

/** Resolves a path relative to the running Pi coding-agent distribution. */
function resolvePiInternalModuleUrl(relativePath: string): string {
    const codingAgentDirectory = resolve(resolveRunningPiPackageDirectory(), "dist");
    if (relativePath.length === 0 || isAbsolute(relativePath)) {
        throw new TypeError("Pi internal module path must be relative to the coding-agent package");
    }
    const modulePath = resolve(codingAgentDirectory, relativePath);
    const pathWithinPackage = relative(codingAgentDirectory, modulePath);
    if (
        pathWithinPackage.length === 0 ||
        pathWithinPackage === ".." ||
        pathWithinPackage.startsWith(`..${sep}`) ||
        isAbsolute(pathWithinPackage)
    ) {
        throw new TypeError("Pi internal module path escapes the coding-agent package");
    }
    return pathToFileURL(modulePath).href;
}

/** Reports a disabled best-effort patch without interrupting extension startup. */
export function warnPiInternalPatchUnavailable(
    scope: string,
    feature: string,
    cause?: unknown,
): void {
    let suffix = "";
    if (cause instanceof Error && cause.message.length > 0) {
        suffix = `: ${cause.message}`;
    }
    console.warn(`[${scope}] ${feature} unavailable; Pi internals may have changed${suffix}`);
}

async function parseImportedModule<T>(
    moduleUrl: string,
    options: PiInternalModuleLoadOptions<T>,
): Promise<T | undefined> {
    const imported: unknown = await import(moduleUrl);
    return options.parse(imported);
}

/** Loads a runtime-owned export from Pi's bundle before its unbundled fallback module. */
export async function loadPiRuntimeModule<T>(
    fallbackRelativePath: string,
    options: PiInternalModuleLoadOptions<T>,
): Promise<T | undefined> {
    try {
        for (const moduleUrl of resolvePiEntrypointModuleUrls()) {
            const parsed = await parseImportedModule(moduleUrl, options);
            if (parsed !== undefined) return parsed;
        }
        const fallback = await parseImportedModule(
            resolvePiInternalModuleUrl(fallbackRelativePath),
            options,
        );
        if (fallback !== undefined) return fallback;
        warnPiInternalPatchUnavailable(options.scope, options.feature);
        return undefined;
    } catch (cause: unknown) {
        warnPiInternalPatchUnavailable(options.scope, options.feature, cause);
        return undefined;
    }
}
