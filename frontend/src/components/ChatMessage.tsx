import {
    isToolPart,
    MANAGE_WATCHLIST,
    toolNameOf,
    type AppUIMessage,
    type ManageWatchlistOutput,
} from '../lib/chat'
import { ToolActivity } from './ToolActivity'
import { WatchlistConfirm, WatchlistOutcome } from './WatchlistConfirm'

interface ChatMessageProps {
    message: AppUIMessage
    onToolResult: (toolCallId: string, output: ManageWatchlistOutput) => void
}

/**
 * Renders one chat turn from its parts: text, retrieval/tool activity, and — for
 * the HITL `manage_watchlist` tool — either the approve/deny prompt (while
 * awaiting confirmation) or the settled outcome.
 */
export function ChatMessage({ message, onToolResult }: ChatMessageProps) {
    const isUser = message.role === 'user'

    return (
        <div className={isUser ? 'msg msg--user' : 'msg msg--assistant'}>
            <div className="msg__role">{isUser ? 'You' : 'TheMovie'}</div>
            <div className="msg__body">
                {message.parts.map((part, index) => {
                    const key = isToolPart(part)
                        ? `tool-${part.toolCallId}`
                        : `${message.id}-p${index}`

                    if (part.type === 'text') {
                        return part.text ? (
                            <p key={key} className="msg__text">
                                {part.text}
                            </p>
                        ) : null
                    }

                    if (isToolPart(part)) {
                        const name = toolNameOf(part)
                        if (name === MANAGE_WATCHLIST) {
                            if (part.state === 'input-available') {
                                return (
                                    <WatchlistConfirm
                                        key={key}
                                        input={part.input}
                                        onResolve={(output) =>
                                            onToolResult(part.toolCallId, output)
                                        }
                                    />
                                )
                            }
                            if (part.state === 'output-available') {
                                return <WatchlistOutcome key={key} output={part.output} />
                            }
                            return null
                        }
                        return <ToolActivity key={key} name={name} state={part.state} />
                    }

                    return null
                })}
            </div>
        </div>
    )
}
