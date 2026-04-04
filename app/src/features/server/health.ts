import {
    SERVER_HEALTH_URL,
    inFlightCheck,
    setState,
    setInFlightCheck
} from "./state";

export async function probeHealth() {
    if (inFlightCheck) return inFlightCheck;

    const check = (async () => {
        try {
            const response = await fetch(SERVER_HEALTH_URL, {
                method: "GET",
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`Health check failed (${response.status})`);
            }

            const data = await response.json();
            if (data.status !== "ok") {
                throw new Error(`Health check is not ok`);
            }

            setState({
                status: "connected",
                lastOkAt: Date.now(),
                errorMessage: null
            });
        } catch (error) {
            setState({
                status: "error",
                lastOkAt: null,
                errorMessage:
                    error instanceof Error
                        ? error.message
                        : "Unknown health error"
            });
        } finally {
            setInFlightCheck(null);
        }
    })();

    setInFlightCheck(check);
    return check;
}
