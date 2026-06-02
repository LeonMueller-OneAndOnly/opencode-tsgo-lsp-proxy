import { createMessageParser } from "./parser.js";
const isJsonRpcRequest = (message) => typeof message === "object" && message !== null && "id" in message && "method" in message;
const isJsonRpcNotification = (message) => typeof message === "object" && message !== null && !("id" in message) && "method" in message;
const isJsonRpcResponse = (message) => typeof message === "object" && message !== null && "id" in message && !("method" in message);
const isDocumentLifecycleNotification = (message) => {
    if (!isJsonRpcNotification(message))
        return false;
    switch (message.method) {
        case "textDocument/didOpen":
        case "textDocument/didChange":
        case "textDocument/didSave":
        case "textDocument/didClose":
            return true;
        default:
            return false;
    }
};
const getUriFromLifecycleMessage = (message) => {
    const params = message.params;
    if (!params || typeof params !== "object")
        return null;
    const typedParams = params;
    return typeof typedParams.textDocument?.uri === "string" ? typedParams.textDocument.uri : null;
};
export const createProxyController = ({ createChild, sendToClient, writeToClientStderr, logger, clock, generateRequestId, onCrashLoopSuppressed, maxRestartsPerWindow = 4, restartWindowMs = 60_000, }) => {
    let childGeneration = 0;
    let activeChild = null;
    let crashLoopSuppressed = false;
    let serverReady = false;
    let lastServerActivityAtMs = null;
    let clientInitializeRequest = null;
    let clientInitializeResponseSent = false;
    let clientInitializedNotification = null;
    let clientRequestedExit = false;
    const restartTimestampsMs = [];
    const openDocumentStateByUri = new Map();
    const pendingClientMessages = [];
    const internalInitializeRequestIds = new Set();
    const inFlightClientRequestsById = new Map();
    const getState = () => ({
        childGeneration,
        serverReady,
        restartCountInWindow: restartTimestampsMs.length,
        crashLoopSuppressed,
        lastServerActivityAtMs,
        openDocumentCount: openDocumentStateByUri.size,
    });
    const logDetails = (details = {}) => ({
        ...details,
        childGeneration,
        serverReady,
    });
    const markServerActivity = () => {
        lastServerActivityAtMs = clock.now();
    };
    const forwardToServer = (message) => {
        if (!activeChild || crashLoopSuppressed)
            return;
        const serialized = JSON.stringify(message);
        const framed = `Content-Length: ${Buffer.byteLength(serialized, "utf8")}\r\n\r\n${serialized}`;
        activeChild.process.stdin.write(framed);
    };
    const flushPendingClientMessages = () => {
        if (!serverReady || !activeChild)
            return;
        while (pendingClientMessages.length > 0) {
            const message = pendingClientMessages.shift();
            if (!message)
                continue;
            if (isJsonRpcRequest(message) && message.method !== "initialize") {
                inFlightClientRequestsById.set(message.id, message);
            }
            forwardToServer(message);
        }
    };
    const replayInFlightClientRequests = () => {
        if (!activeChild || !serverReady)
            return;
        for (const request of inFlightClientRequestsById.values()) {
            forwardToServer(request);
        }
    };
    const replayOpenDocuments = () => {
        if (!activeChild || !serverReady)
            return;
        for (const { replayMessages } of openDocumentStateByUri.values()) {
            for (const message of replayMessages) {
                forwardToServer(message);
            }
        }
    };
    const transitionServerReady = () => {
        serverReady = true;
        if (clientInitializedNotification) {
            forwardToServer(clientInitializedNotification);
        }
        replayOpenDocuments();
        replayInFlightClientRequests();
        flushPendingClientMessages();
    };
    const handleInternalInitializeResponse = (message) => {
        if (message.id === null)
            return false;
        if (!internalInitializeRequestIds.has(message.id))
            return false;
        internalInitializeRequestIds.delete(message.id);
        if ("error" in message) {
            logger.warn("internal initialize failed", logDetails({ reason: "initialize-failed" }));
            restartServer("initialize-failed");
            return true;
        }
        logger.info("server reinitialized", logDetails());
        if (clientInitializeRequest && !clientInitializeResponseSent) {
            clientInitializeResponseSent = true;
            sendToClient({
                ...message,
                id: clientInitializeRequest.id,
            });
        }
        transitionServerReady();
        return true;
    };
    const maybeReplayInitialize = () => {
        if (!activeChild || !clientInitializeRequest)
            return;
        serverReady = false;
        const internalInitializeId = `proxy:initialize:${generateRequestId()}`;
        internalInitializeRequestIds.add(internalInitializeId);
        forwardToServer({
            ...clientInitializeRequest,
            id: internalInitializeId,
        });
    };
    const bufferOrForwardClientMessage = (message) => {
        if (!activeChild || crashLoopSuppressed)
            return;
        if (serverReady ||
            !clientInitializeRequest ||
            (isJsonRpcRequest(message) && message.method === "initialize")) {
            forwardToServer(message);
            return;
        }
        if (isDocumentLifecycleNotification(message)) {
            return;
        }
        pendingClientMessages.push(message);
    };
    const updateReplayState = (message) => {
        const uri = getUriFromLifecycleMessage(message);
        if (!uri)
            return;
        switch (message.method) {
            case "textDocument/didOpen": {
                openDocumentStateByUri.set(uri, {
                    replayMessages: [message],
                });
                break;
            }
            case "textDocument/didChange":
            case "textDocument/didSave": {
                const existingState = openDocumentStateByUri.get(uri);
                if (!existingState)
                    return;
                existingState.replayMessages.push(message);
                break;
            }
            case "textDocument/didClose": {
                openDocumentStateByUri.delete(uri);
                break;
            }
            default:
                break;
        }
    };
    const handleClientNotification = (message) => {
        updateReplayState(message);
        if (message.method === "exit") {
            clientRequestedExit = true;
            bufferOrForwardClientMessage(message);
            return;
        }
        if (message.method === "initialized") {
            clientInitializedNotification = message;
            if (!serverReady) {
                return;
            }
        }
        if (message.method === "textDocument/didClose") {
            bufferOrForwardClientMessage(message);
            return;
        }
        bufferOrForwardClientMessage(message);
    };
    const onServerMessage = (message) => {
        markServerActivity();
        if (isJsonRpcResponse(message)) {
            if (message.id !== null) {
                inFlightClientRequestsById.delete(message.id);
            }
            if (handleInternalInitializeResponse(message))
                return;
            if (clientInitializeRequest && message.id === clientInitializeRequest.id) {
                clientInitializeResponseSent = true;
                transitionServerReady();
            }
        }
        sendToClient(message);
    };
    const detachChild = (child) => {
        child.dispose();
        if (activeChild?.generation === child.generation) {
            activeChild = null;
        }
    };
    const spawnServer = (reason) => {
        if (crashLoopSuppressed)
            return;
        const child = createChild();
        childGeneration += 1;
        clientRequestedExit = false;
        serverReady = false;
        lastServerActivityAtMs = clock.now();
        const parser = createMessageParser({
            onMessage: onServerMessage,
            onInvalidFrame: (headerText) => {
                logger.warn("invalid server frame", logDetails({ headerText }));
            },
            onInvalidPayload: () => {
                logger.warn("invalid server payload", logDetails());
            },
        });
        const onStdoutData = (chunk) => {
            parser(chunk);
        };
        const onStderrData = (chunk) => {
            markServerActivity();
            writeToClientStderr(chunk);
        };
        const onExit = (code, signal) => {
            if (activeChild?.generation !== active.generation)
                return;
            logger.warn("server exited", logDetails({ code, signal }));
            serverReady = false;
            detachChild(active);
            if (crashLoopSuppressed || clientRequestedExit)
                return;
            attemptRestart(signal ? "server-signal-exit" : "server-exit");
        };
        const active = {
            generation: childGeneration,
            process: child,
            dispose: () => {
                child.stdout.off("data", onStdoutData);
                child.stderr.off("data", onStderrData);
                child.off("exit", onExit);
            },
        };
        activeChild = active;
        child.stdout.on("data", onStdoutData);
        child.stderr.on("data", onStderrData);
        child.on("exit", onExit);
        logger.info("spawned tsgo proxy child", logDetails({ reason }));
        if (reason === "restart" && clientInitializeRequest) {
            maybeReplayInitialize();
        }
    };
    const attemptRestart = (reason) => {
        const now = clock.now();
        while (restartTimestampsMs.length > 0 &&
            typeof restartTimestampsMs[0] === "number" &&
            now - restartTimestampsMs[0] > restartWindowMs) {
            restartTimestampsMs.shift();
        }
        if (restartTimestampsMs.length >= maxRestartsPerWindow) {
            crashLoopSuppressed = true;
            logger.warn("restart suppressed after crash loop", logDetails({ reason }));
            onCrashLoopSuppressed?.(reason);
            return;
        }
        restartTimestampsMs.push(now);
        spawnServer("restart");
    };
    const restartServer = (reason) => {
        logger.warn("restarting tsgo child", logDetails({ reason }));
        if (activeChild) {
            const childToKill = activeChild;
            detachChild(childToKill);
            if (!childToKill.process.killed) {
                childToKill.process.kill("SIGTERM");
            }
        }
        attemptRestart(reason);
    };
    const start = () => {
        spawnServer("initial");
    };
    const stop = () => {
        if (activeChild) {
            const childToKill = activeChild;
            detachChild(childToKill);
            if (!childToKill.process.killed) {
                childToKill.process.kill("SIGTERM");
            }
        }
    };
    const handleClientMessage = (message) => {
        if (isJsonRpcRequest(message) && message.method === "initialize") {
            clientRequestedExit = false;
            clientInitializeRequest = message;
            clientInitializeResponseSent = false;
            bufferOrForwardClientMessage(message);
            return;
        }
        if (isJsonRpcNotification(message)) {
            handleClientNotification(message);
            return;
        }
        if (isJsonRpcRequest(message) && serverReady) {
            inFlightClientRequestsById.set(message.id, message);
        }
        bufferOrForwardClientMessage(message);
    };
    return {
        getState,
        start,
        stop,
        restartServer,
        handleClientMessage,
    };
};
