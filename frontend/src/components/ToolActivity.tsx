import { Check, TriangleAlert } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { toolLabel } from '../lib/chat'

/**
 * A "what the agent is doing" status row for a retrieval/read tool call, built on
 * the shadcn `Marker`: a shimmering spinner label while running, a check when
 * done, a warning on error. Lets the user watch the agent escalate across
 * retrieval tiers. The parent transcript is the live region, so this needs no
 * `role` of its own.
 */
export function ToolActivity({ name, state }: { name: string; state: string }) {
    const errored = state === 'output-error'
    const running = state === 'input-streaming' || state === 'input-available'
    const text = errored ? `${name.replace(/_/g, ' ')} failed` : toolLabel(name, !running)

    return (
        <Marker className={cn('px-3', errored && 'text-destructive')}>
            <MarkerIcon>
                {errored ? (
                    <TriangleAlert />
                ) : running ? (
                    <Spinner />
                ) : (
                    <Check className="text-pro" />
                )}
            </MarkerIcon>
            {/* `shimmer` animates the label only while the tool is in flight. */}
            <MarkerContent className={cn(running && 'shimmer')}>
                {text}
                {running ? '…' : ''}
            </MarkerContent>
        </Marker>
    )
}
