import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Starter prompts shown in the empty chat — a mix of the headline thematic
// search, a concrete watchlist action, and an open-ended "what to watch".
export const CHAT_STARTERS = [
    'A movie where the hero later becomes the villain',
    'Slow-burn sci-fi from the 2010s',
    'What should I watch tonight?',
    'Add Inception to my watchlist',
]

// Always-available quick prompts, shown above the composer mid-conversation so
// there's a clickable idea even after the chat has started (recognition over
// recall). Kept generic so they make sense as a follow-up at any point.
export const CHAT_QUICK_PROMPTS = [
    'What should I watch tonight?',
    'Something funny and under 100 minutes',
    'A mind-bending thriller',
    'Hidden gems from the 2000s',
    'Movies like Inception',
]

interface ChatSuggestionsProps {
    prompts: string[]
    onSelect: (text: string) => void
    /** Disable while a reply is streaming (sending another would interleave). */
    disabled?: boolean
    className?: string
}

/**
 * A row of clickable prompt chips. Used both for the empty-chat starters
 * (centered) and the persistent quick-prompts row above the composer
 * (horizontally scrollable). Selecting one sends it as a message.
 */
export function ChatSuggestions({ prompts, onSelect, disabled, className }: ChatSuggestionsProps) {
    return (
        <div className={cn('flex flex-wrap gap-2.5', className)}>
            {prompts.map((text) => (
                <Button
                    key={text}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => onSelect(text)}
                >
                    {text}
                </Button>
            ))}
        </div>
    )
}
