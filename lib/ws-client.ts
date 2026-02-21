/**
 * ham-radio-recorder — WebSocket Client
 *
 * Promise-based WebSocket client for communicating with UDP-Bridge.
 * Supports connect with retry, send-and-wait-for-response, and clean disconnect.
 *
 * Usage:
 *   const ws = new WsClient()
 *   await ws.connect("ws://127.0.0.1:17800/ws")
 *   const result = await ws.sendCommand(
 *     { type: "setFreq", port: 0, freq: 14074000 },
 *     "setFreqResult"
 *   )
 *   ws.disconnect()
 */

/** Options for WsClient.connect() */
export interface ConnectOptions {
    /** Connection timeout per attempt in ms (default: 5000) */
    timeoutMs?: number
    /** Maximum number of connection attempts (default: 3) */
    maxRetries?: number
    /** Delay between retries in ms (default: 1000) */
    retryDelayMs?: number
}

/** Options for WsClient.sendCommand() */
export interface SendCommandOptions {
    /** Response timeout in ms (default: 5000) */
    timeoutMs?: number
}

export class WsClient {
    private ws: WebSocket | null = null
    private messageListeners: Array<(data: unknown) => void> = []

    /** Whether the WebSocket is currently open */
    get isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN
    }

    /**
     * Connect to a WebSocket server with retry logic.
     *
     * @param url  Full WebSocket URL (e.g. "ws://127.0.0.1:17800/ws")
     * @param opts Connect options (timeout, retries, delay)
     * @throws Error if all connection attempts fail
     */
    async connect(url: string, opts: ConnectOptions = {}): Promise<void> {
        const {
            timeoutMs = 5000,
            maxRetries = 3,
            retryDelayMs = 1000
        } = opts

        // Disconnect any existing connection
        this.disconnect()

        let lastError: Error | null = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.attemptConnect(url, timeoutMs)
                console.log(`[WsClient] Connected to ${url} (attempt ${attempt})`)
                return // Success
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err))
                console.warn(
                    `[WsClient] Connection attempt ${attempt}/${maxRetries} failed:`,
                    lastError.message
                )

                if (attempt < maxRetries) {
                    await this.delay(retryDelayMs)
                }
            }
        }

        throw new Error(
            `WebSocket connection failed after ${maxRetries} attempts: ${lastError?.message}`
        )
    }

    /**
     * Send a JSON command and wait for a response with a matching `type` field.
     *
     * @param command       Object to send as JSON (must have a `type` field)
     * @param expectedType  The `type` value of the expected response
     * @param opts          Send options (timeout)
     * @returns The parsed response object
     * @throws Error on timeout or if WebSocket is not connected
     */
    async sendCommand<C extends { type: string }, T extends { type: string; success?: boolean }>(
        command: C,
        expectedType: string,
        opts: SendCommandOptions = {}
    ): Promise<T> {
        const { timeoutMs = 5000 } = opts

        if (!this.isConnected || !this.ws) {
            throw new Error("WebSocket is not connected")
        }

        return new Promise<T>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null

            // Message listener that watches for the expected response type
            const listener = (data: unknown) => {
                const msg = data as Record<string, unknown>
                if (msg && msg.type === expectedType) {
                    // Found matching response
                    cleanup()
                    resolve(msg as T)
                }
            }

            const cleanup = () => {
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                this.removeMessageListener(listener)
            }

            // Set timeout
            timer = setTimeout(() => {
                cleanup()
                reject(
                    new Error(
                        `Timeout waiting for "${expectedType}" response (${timeoutMs}ms)`
                    )
                )
            }, timeoutMs)

            // Register listener before sending
            this.addMessageListener(listener)

            // Send command
            try {
                this.ws!.send(JSON.stringify(command))
                console.log(`[WsClient] Sent:`, command)
            } catch (err) {
                cleanup()
                reject(
                    new Error(
                        `Failed to send command: ${err instanceof Error ? err.message : String(err)}`
                    )
                )
            }
        })
    }

    /**
     * Disconnect the WebSocket cleanly.
     */
    disconnect(): void {
        if (this.ws) {
            // Remove all event listeners to avoid leaks
            this.ws.onopen = null
            this.ws.onclose = null
            this.ws.onerror = null
            this.ws.onmessage = null

            if (
                this.ws.readyState === WebSocket.OPEN ||
                this.ws.readyState === WebSocket.CONNECTING
            ) {
                this.ws.close(1000, "Client disconnect")
            }
            this.ws = null
        }
        this.messageListeners = []
        console.log("[WsClient] Disconnected")
    }

    // ─── Private Helpers ────────────────────────────────────────────────

    /**
     * Single connection attempt with timeout.
     */
    private attemptConnect(url: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null

            const ws = new WebSocket(url)

            timer = setTimeout(() => {
                timer = null
                ws.close()
                reject(new Error(`Connection timeout (${timeoutMs}ms)`))
            }, timeoutMs)

            ws.onopen = () => {
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                this.ws = ws
                this.setupMessageHandler()
                resolve()
            }

            ws.onerror = (event) => {
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                reject(new Error(`WebSocket error: ${JSON.stringify(event)}`))
            }

            ws.onclose = (event) => {
                if (timer) {
                    clearTimeout(timer)
                    timer = null
                }
                if (!this.ws) {
                    // Only reject if we haven't successfully connected
                    reject(
                        new Error(`WebSocket closed before open: code=${event.code}`)
                    )
                }
            }
        })
    }

    /**
     * Set up the onmessage handler to dispatch to registered listeners.
     */
    private setupMessageHandler(): void {
        if (!this.ws) return

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data as string)
                console.log("[WsClient] Received:", data)

                // Dispatch to all registered listeners
                for (const listener of [...this.messageListeners]) {
                    listener(data)
                }
            } catch (err) {
                console.error("[WsClient] Failed to parse message:", event.data, err)
            }
        }

        this.ws.onclose = (event) => {
            console.log(
                `[WsClient] Connection closed: code=${event.code}, reason=${event.reason}`
            )
            this.ws = null
        }

        this.ws.onerror = (event) => {
            console.error("[WsClient] Error:", event)
        }
    }

    private addMessageListener(listener: (data: unknown) => void): void {
        this.messageListeners.push(listener)
    }

    private removeMessageListener(listener: (data: unknown) => void): void {
        const idx = this.messageListeners.indexOf(listener)
        if (idx >= 0) {
            this.messageListeners.splice(idx, 1)
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
