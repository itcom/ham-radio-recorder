#!/usr/bin/env node
/**
 * Post-build script: Inline shared chunks into the background service worker.
 *
 * MV3 service workers cannot call importScripts() inside event handlers.
 * Parcel code-splits shared modules (e.g. storage.ts) into separate chunks
 * and lazy-loads them via importScripts. This breaks when the SW wakes up
 * to handle an alarm and tries to importScripts inside the listener.
 *
 * Fix:
 * 1. Prepend all root-level JS chunks into the SW bundle
 * 2. Replace ALL importScripts() calls with no-ops (since everything is inlined)
 */
import { readdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"

const BUILD_DIRS = ["build/chrome-mv3-dev", "build/chrome-mv3-prod"]
const BG_PATH = "static/background/index.js"

for (const buildDir of BUILD_DIRS) {
    try {
        const files = readdirSync(buildDir)
        // Find root-level JS chunks (not popup, options, or offscreen entry points)
        const chunks = files.filter(
            (f) =>
                f.endsWith(".js") &&
                !f.startsWith("popup") &&
                !f.startsWith("options") &&
                !f.startsWith("offscreen")
        )

        if (chunks.length === 0) {
            console.log(`[inline-chunks] ${buildDir}: no chunks to inline`)
            continue
        }

        const bgFile = join(buildDir, BG_PATH)
        let bgContent
        try {
            bgContent = readFileSync(bgFile, "utf8")
        } catch {
            console.log(`[inline-chunks] ${buildDir}: no background/index.js, skipping`)
            continue
        }

        // Read and concatenate all chunks
        const chunkContents = chunks.map((c) => {
            const content = readFileSync(join(buildDir, c), "utf8")
            return `// --- inlined chunk: ${c} ---\n${content}`
        })

        // Replace ALL importScripts calls with no-ops.
        // Parcel generates various patterns — rather than matching each one,
        // we override importScripts itself at the top of the bundle.
        const importScriptsShim = `
// --- MV3 importScripts shim ---
// All shared chunks are inlined above, so importScripts is no longer needed.
// Override it to prevent Parcel's lazy loader from calling it inside event handlers.
const __originalImportScripts = typeof importScripts !== 'undefined' ? importScripts : undefined;
importScripts = function(...args) {
    console.log('[SW] importScripts shimmed (no-op):', args);
};
`

        // Build the final merged file
        const merged =
            chunkContents.join("\n") +
            "\n" +
            importScriptsShim +
            "\n// --- original background ---\n" +
            bgContent

        writeFileSync(bgFile, merged)

        console.log(
            `[inline-chunks] ${buildDir}: inlined ${chunks.length} chunk(s) + shimmed importScripts → ${BG_PATH}`
        )
        console.log(`  chunks: ${chunks.join(", ")}`)
    } catch (err) {
        // Build dir might not exist, that's OK
        if (err.code !== "ENOENT") {
            console.error(`[inline-chunks] ${buildDir}: ${err.message}`)
        }
    }
}
