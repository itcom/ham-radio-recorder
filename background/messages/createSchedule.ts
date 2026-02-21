/**
 * Message handler: createSchedule
 * Creates or updates a recording schedule and its alarm.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { createAlarmFromSchedule } from "~background/index"
import { upsertSchedule } from "~lib/storage"
import type { Schedule } from "~lib/types"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    try {
        const schedule = req.body as Schedule

        if (!schedule || !schedule.id || !schedule.startTime || !schedule.endTime) {
            res.send({ ok: false, error: "Invalid schedule: missing required fields" })
            return
        }

        // Save schedule to storage
        await upsertSchedule(schedule)

        // Create or update the chrome alarm
        await createAlarmFromSchedule(schedule)

        res.send({ ok: true })
    } catch (err) {
        res.send({ ok: false, error: String(err) })
    }
}

export default handler
