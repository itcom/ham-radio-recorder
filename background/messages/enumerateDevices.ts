/**
 * Message handler: enumerateDevices
 * Creates offscreen document to enumerate audio input devices,
 * then returns the device list.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { addLog } from "~lib/storage"

const OFFSCREEN_URL = "offscreen.html"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
    try {
        // Ensure offscreen document exists
        const exists = await chrome.offscreen.hasDocument?.()
        if (!exists) {
            await chrome.offscreen.createDocument({
                url: OFFSCREEN_URL,
                reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
                justification: "Enumerating audio input devices"
            })
        }

        // Wait a moment for offscreen to initialize
        await new Promise((r) => setTimeout(r, 500))

        // Request device list from offscreen
        const response = await chrome.runtime.sendMessage({
            target: "offscreen",
            action: "enumerateDevices"
        })

        if (response?.success) {
            res.send({ devices: response.devices })
        } else {
            res.send({ devices: [], error: response?.error ?? "Unknown error" })
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await addLog("ERROR", `enumerateDevices failed: ${msg}`)
        res.send({ devices: [], error: msg })
    }
}

export default handler
