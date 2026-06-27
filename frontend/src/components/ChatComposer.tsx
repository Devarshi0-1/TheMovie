import { ChatMessageInputSchema } from '@themovie/schemas'
import { useForm } from '@tanstack/react-form'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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
            className="flex flex-col gap-1.5 border-t border-border bg-background p-3"
            onSubmit={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void form.handleSubmit()
            }}
        >
            <div className="flex items-end gap-2">
                <label htmlFor="chat-composer-input" className="sr-only">
                    Message
                </label>
                <form.Field name="message">
                    {(field) => (
                        <Textarea
                            id="chat-composer-input"
                            className="min-h-0 flex-1 resize-none"
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
                            aria-describedby="chat-composer-hint"
                            disabled={disabled}
                        />
                    )}
                </form.Field>

                {streaming ? (
                    <Button type="button" variant="outline" onClick={onStop}>
                        Stop
                    </Button>
                ) : (
                    <form.Subscribe
                        selector={(s) => ({ canSubmit: s.canSubmit, value: s.values.message })}
                    >
                        {({ canSubmit, value }) => (
                            <Button
                                type="submit"
                                disabled={disabled || !canSubmit || value.trim().length === 0}
                            >
                                Send
                            </Button>
                        )}
                    </form.Subscribe>
                )}
            </div>

            {/* Surface the shortcut instead of hiding it in code (NN/g: recognition over recall). */}
            <p id="chat-composer-hint" className="px-1 text-xs text-muted-foreground">
                Press Enter to send, Shift+Enter for a new line.
            </p>
        </form>
    )
}
