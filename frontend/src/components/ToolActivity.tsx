import { toolLabel } from '../lib/chat'

/**
 * A compact "what the agent is doing" chip for a retrieval/read tool call —
 * spinner while running, check when done, warning on error. Lets the user watch
 * the agent escalate across retrieval tiers.
 */
export function ToolActivity({ name, state }: { name: string; state: string }) {
    const errored = state === 'output-error'
    const running = state === 'input-streaming' || state === 'input-available'
    const icon = errored ? '⚠' : running ? '◌' : '✓'
    const text = errored ? `${name.replace(/_/g, ' ')} failed` : toolLabel(name, !running)

    return (
        <div className={errored ? 'tool-activity tool-activity--error' : 'tool-activity'}>
            <span
                className={
                    running
                        ? 'tool-activity__icon tool-activity__icon--spin'
                        : 'tool-activity__icon'
                }
            >
                {icon}
            </span>
            <span>
                {text}
                {running ? '…' : ''}
            </span>
        </div>
    )
}
