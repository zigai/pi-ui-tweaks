import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, onTestFinished, test } from "vitest";

import { loadTreeInternals } from "../src/internal-imports.ts";

type TreeRuntimeModule = {
    readonly TreeSelectorComponent: object;
};

function isTreeRuntimeModule(value: unknown): value is TreeRuntimeModule {
    return (
        typeof value === "object" &&
        value !== null &&
        "TreeSelectorComponent" in value &&
        typeof value.TreeSelectorComponent === "function"
    );
}

const treeRuntimeParser = {
    parse(value: unknown): TreeRuntimeModule {
        if (!isTreeRuntimeModule(value)) {
            throw new Error("fixture module must export its tree constructor");
        }
        return value;
    },
};

test.each(["bundled", "modular"])(
    "loads the tree constructor used by a %s Pi runtime",
    async (runtime) => {
        const fixtureRoot = await mkdtemp(join(tmpdir(), "pi-tree-runtime-"));
        const packageDirectory = join(
            fixtureRoot,
            "node_modules",
            "@earendil-works",
            "pi-coding-agent",
        );
        const distDirectory = join(packageDirectory, "dist");
        const componentDirectory = join(distDirectory, "modes", "interactive", "components");
        const themeDirectory = join(distDirectory, "modes", "interactive", "theme");
        const bundleDirectory = join(distDirectory, "bundle");
        const originalEntrypoint = process.argv[1];
        const originalPiFlag = process.env.PI_CODING_AGENT;
        const originalPackageDirectory = process.env.PI_PACKAGE_DIR;
        onTestFinished(async () => {
            process.argv[1] = originalEntrypoint;
            if (originalPiFlag === undefined) {
                delete process.env.PI_CODING_AGENT;
            } else {
                process.env.PI_CODING_AGENT = originalPiFlag;
            }
            if (originalPackageDirectory === undefined) {
                delete process.env.PI_PACKAGE_DIR;
            } else {
                process.env.PI_PACKAGE_DIR = originalPackageDirectory;
            }
            await rm(fixtureRoot, { recursive: true, force: true });
        });

        for (const directory of [componentDirectory, themeDirectory, bundleDirectory]) {
            await mkdir(directory, { recursive: true });
        }
        await writeFile(
            join(packageDirectory, "package.json"),
            '{"name":"@earendil-works/pi-coding-agent","type":"module"}\n',
        );
        const modularSelectorPath = join(componentDirectory, "tree-selector.js");
        const selectorSource = "export class TreeSelectorComponent {}\n";
        await writeFile(modularSelectorPath, selectorSource);
        await writeFile(
            join(themeDirectory, "theme.js"),
            "export function initTheme() {}\nexport const theme = {};\n",
        );

        let entrypointPath = join(distDirectory, "cli.js");
        if (runtime === "bundled") {
            entrypointPath = join(bundleDirectory, "cli.js");
            await writeFile(join(bundleDirectory, "chunk-tree.js"), selectorSource);
            await writeFile(
                entrypointPath,
                'export { TreeSelectorComponent } from "./chunk-tree.js";\n',
            );
        } else {
            await writeFile(
                entrypointPath,
                'export { TreeSelectorComponent } from "./modes/interactive/components/tree-selector.js";\n',
            );
        }
        process.argv[1] = entrypointPath;
        process.env.PI_CODING_AGENT = "true";
        delete process.env.PI_PACKAGE_DIR;

        // Import the host entrypoint independently: matching export shapes alone would
        // also accept the unused modular class and miss the original regression.
        const host = treeRuntimeParser.parse(await import(pathToFileURL(entrypointPath).href));
        const internals = await loadTreeInternals();
        expect(internals).toBeDefined();
        expect(internals?.[0].TreeSelectorComponent).toBe(host.TreeSelectorComponent);
        expect(internals?.[1].theme).toEqual({});

        if (runtime === "bundled") {
            const modular = treeRuntimeParser.parse(
                await import(pathToFileURL(modularSelectorPath).href),
            );
            expect(internals?.[0].TreeSelectorComponent).not.toBe(modular.TreeSelectorComponent);
        }
    },
);
