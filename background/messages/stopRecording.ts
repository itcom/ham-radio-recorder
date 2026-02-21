/**
 * Message handler: stopRecording
 * Stops the currently running recording.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { stopRecording } from "~background/index"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
    await stopRecording()
    res.send({ ok: true })
}

export default handler
