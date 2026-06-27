import { cn } from '@/lib/utils'
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
        <div className={cn('flex max-w-[85%] flex-col gap-1', isUser && 'items-end self-end')}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {isUser ? 'You' : 'TheMovie'}
            </div>
            <div className="flex flex-col gap-2">
                {message.parts.map((part, index) => {
                    // Tool parts have a stable id; other parts (text, reasoning,
                    // step) have none, so key on type + index — stable for the
                    // append-only stream and resilient if part kinds interleave.
                    const key = isToolPart(part)
                        ? `tool-${part.toolCallId}`
                        : `${message.id}-${part.type}-${index}`

                    if (part.type === 'text') {
                        return part.text ? (
                            <p
                                key={key}
                                className={cn(
                                    'm-0 whitespace-pre-wrap rounded-xl border px-3.5 py-2.5 leading-relaxed',
                                    isUser
                                        ? 'border-primary/25 bg-accent-soft'
                                        : 'border-border bg-muted',
                                )}
                            >
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
