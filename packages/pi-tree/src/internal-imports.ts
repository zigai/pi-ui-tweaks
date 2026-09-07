import { loadPiRuntimeModule } from "@zigai/pi-extension-internals";

export type TreeSelectorModule = {
    TreeSelectorComponent: new (
        entries: unknown[],
        selectedId: string | null,
        height: number,
        onSelect: () => undefined,
        onCancel: () => undefined,
        onLabel: () => undefined,
        onDelete: undefined,
        onFork: undefined,
    ) => object;
};

function isObjectIdentity(value: unknown): value is object {
    return (typeof value === "object" && value !== null) || typeof value === "function";
}

export type ThemeModule = {
    initTheme: (name: string | undefined, force: boolean) => void;
    theme: object;
};

export async function loadTreeInternals(): Promise<[TreeSelectorModule, ThemeModule] | undefined> {
    const treeSelectorModule = await loadPiRuntimeModule(
        "modes/interactive/components/tree-selector.js",
        {
            scope: "pi-tree",
            feature: "tree selector patch",
            parse(module: unknown): TreeSelectorModule | undefined {
                if (
                    !isObjectIdentity(module) ||
                    !("TreeSelectorComponent" in module) ||
                    typeof module.TreeSelectorComponent !== "function"
                ) {
                    return undefined;
                }
                // SAFETY: The export is constructible in Pi's private module contract; its
                // returned selector and tree-list methods are validated before they are patched.
                return module as TreeSelectorModule;
            },
        },
    );
    if (treeSelectorModule === undefined) return undefined;

    const themeModule = await loadPiRuntimeModule("modes/interactive/theme/theme.js", {
        scope: "pi-tree",
        feature: "tree selector patch",
        parse(module: unknown): ThemeModule | undefined {
            if (
                !isObjectIdentity(module) ||
                !("initTheme" in module) ||
                typeof module.initTheme !== "function" ||
                !("theme" in module)
            ) {
                return undefined;
            }
            if (!isObjectIdentity(module.theme)) return undefined;
            // SAFETY: initTheme is callable and theme is an object. Its proxy-backed methods
            // cannot be read until initialization, so the caller validates them immediately after initTheme.
            return module as ThemeModule;
        },
    });
    if (themeModule === undefined) return undefined;

    return [treeSelectorModule, themeModule];
}
