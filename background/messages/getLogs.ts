/**
 * Message handler: getLogs
 * Returns recent log entries.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { getLogs } from "~lib/storage"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
    const logs = await getLogs()
    res.send({ logs })
}

export default handler
