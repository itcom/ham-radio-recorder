/**
 * Message handler: getStatus
 * Returns current extension status to popup.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { getStatusAsync } from "~background/index"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
    const status = await getStatusAsync()
    res.send(status)
}

export default handler
