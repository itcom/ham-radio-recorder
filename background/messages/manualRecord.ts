/**
 * Message handler: manualRecord
 * Triggers a recording flow for a specific schedule.
 * Accepts schedule params (frequency, mode, dataMode, durationMin) in req.body.
 */
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { executeRecordingFlow } from "~background/index"
import { addLog } from "~lib/storage"
import type { RecordingParams } from "~lib/types"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
    try {
        const params = req.body as RecordingParams

        if (!params || !params.frequency || !params.mode || !params.durationMin) {
            res.send({ ok: false, error: "Missing recording parameters" })
            return
        }

        await addLog("INFO", "Manual recording triggered", {
            frequency: params.frequency,
            mode: params.mode,
            durationMin: params.durationMin
        })

        // Start recording flow asynchronously (don't wait for completion)
        executeRecordingFlow(params).catch(async (err) => {
            await addLog("ERROR", `Manual recording flow error: ${String(err)}`)
        })

        res.send({ ok: true })
    } catch (err) {
        res.send({ ok: false, error: String(err) })
    }
}

export default handler
