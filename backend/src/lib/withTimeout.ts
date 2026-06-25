// Bound a promise so a slow/hung dependency can't wedge a request indefinitely.
// On timeout the returned promise rejects with `message`; the original promise
// is still awaited internally so a *later* settle stays handled (no unhandled
// rejection) rather than surfacing after the timeout already won.
//
// Why this exists: the shared Redis client reconnects across an outage with a
// very high `maxRetries`, so a command issued while Redis is down would
// otherwise stay pending for the whole outage. Callers that must fail fast
// (the rate limiter's fail-open, the /health probe) wrap their Redis call here.
export function withTimeout<T>(
    work: Promise<T>,
    ms: number,
    message = 'operation timed out',
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms)
        work.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (err) => {
                clearTimeout(timer)
                reject(err)
            },
        )
    })
}
