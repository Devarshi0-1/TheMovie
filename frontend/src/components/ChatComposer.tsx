import { ChatMessageInputSchema } from '@themovie/schemas'
import { useForm } from '@tanstack/react-form'

interface ChatComposerProps {
    onSend: (message: string) => void
    streaming: boolean
    onStop: () => void
    disabled?: boolean
}

/**
 * The chat input — a TanStack Form whose single field is validated by the shared
 * `ChatMessageInputSchema` (Zod). Send is gated on validity; Enter submits,
 * Shift+Enter inserts a newline. While the agent streams, the action becomes a
 * Stop button.
 */
export function ChatComposer({ onSend, streaming, onStop, disabled }: ChatComposerProps) {
    const form = useForm({
        defaultValues: { message: '' },
        validators: { onChange: ChatMessageInputSchema },
        onSubmit: ({ value }) => {
            const text = value.message.trim()
            if (!text) return
            onSend(text)
            form.reset()
        },
    })

    return (
        <form
            className="composer"
            onSubmit={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void form.handleSubmit()
            }}
        >
            <label htmlFor="chat-composer-input" className="sr-only">
                Message
            </label>
            <form.Field name="message">
                {(field) => (
                    <textarea
                        id="chat-composer-input"
                        className="composer__input"
                        name="message"
                        rows={2}
                        placeholder="Describe a movie, ask for a recommendation, or manage your watchlist…"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                void form.handleSubmit()
                            }
                        }}
                        disabled={disabled}
                    />
                )}
            </form.Field>

            {streaming ? (
                <button type="button" className="composer__stop" onClick={onStop}>
                    Stop
                </button>
            ) : (
                <form.Subscribe
                    selector={(s) => ({ canSubmit: s.canSubmit, value: s.values.message })}
                >
                    {({ canSubmit, value }) => (
                        <button
                            type="submit"
                            className="composer__send"
                            disabled={disabled || !canSubmit || value.trim().length === 0}
                        >
                            Send
                        </button>
                    )}
                </form.Subscribe>
            )}
        </form>
    )
}
