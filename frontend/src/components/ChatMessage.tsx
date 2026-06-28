import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Message, MessageContent, MessageHeader } from '@/components/ui/message'
import {
    extractSuggestedMovies,
    isToolPart,
    MANAGE_WATCHLIST,
    toolNameOf,
    type AppUIMessage,
    type ManageWatchlistOutput,
} from '../lib/chat'
import { ChatMovieResults } from './ChatMovieResults'
import { ToolActivity } from './ToolActivity'
import { WatchlistConfirm, WatchlistOutcome } from './WatchlistConfirm'

interface ChatMessageProps {
    message: AppUIMessage
    onToolResult: (toolCallId: string, output: ManageWatchlistOutput) => void
}

/**
 * Renders one chat turn from its parts on the shadcn `Message`/`Bubble`
 * primitives: text bubbles (user right-aligned + amber-tinted, assistant left +
 * muted), retrieval/tool activity, and — for the HITL `manage_watchlist` tool —
 * either the approve/deny prompt (while awaiting confirmation) or the settled
 * outcome.
 */
export function ChatMessage({ message, onToolResult }: ChatMessageProps) {
    const isUser = message.role === 'user'
    // The movies this turn surfaced across its tool calls, rendered as a clickable
    // strip below the text (assistant turns only; empty otherwise).
    const suggestedMovies = extractSuggestedMovies(message)

    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageContent>
                <MessageHeader>{isUser ? 'You' : 'TheMovie'}</MessageHeader>
                {message.parts.map((part, index) => {
                    // Tool parts have a stable id; other parts (text, reasoning,
                    // step) have none, so key on type + index — stable for the
                    // append-only stream and resilient if part kinds interleave.
                    const key = isToolPart(part)
                        ? `tool-${part.toolCallId}`
                        : `${message.id}-${part.type}-${index}`

                    if (part.type === 'text') {
                        return part.text ? (
                            <Bubble key={key} variant={isUser ? 'tinted' : 'muted'}>
                                <BubbleContent className="whitespace-pre-wrap">
                                    {part.text}
                                </BubbleContent>
                            </Bubble>
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

                <ChatMovieResults movies={suggestedMovies} />
            </MessageContent>
        </Message>
    )
}
