/**
 * Message handler: deleteSchedule
 * Removes a schedule and its associated alarm.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { deleteSchedule as removeSchedule } from "~lib/storage"
import { addLog } from "~lib/storage"

const ALARM_PREFIX = "ham-record-"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    try {
        const { id } = req.body as { id: string }

        if (!id) {
            res.send({ ok: false, error: "Missing schedule id" })
            return
        }

        // Remove alarm
        await chrome.alarms.clear(`${ALARM_PREFIX}${id}`)

        // Remove from storage
        await removeSchedule(id)

        await addLog("INFO", `Schedule deleted: ${id}`)

        res.send({ ok: true })
    } catch (err) {
        res.send({ ok: false, error: String(err) })
    }
}

export default handler
