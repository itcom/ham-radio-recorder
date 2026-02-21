/**
 * Message handler: testConnection
 * Tests WebSocket connection to UDP-Bridge.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { testWsConnection } from "~background/index"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
    const result = await testWsConnection()
    res.send(result)
}

export default handler
