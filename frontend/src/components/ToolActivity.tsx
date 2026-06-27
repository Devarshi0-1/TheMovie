import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toolLabel } from '../lib/chat'

/**
 * A compact "what the agent is doing" chip for a retrieval/read tool call —
 * spinner while running, check when done, warning on error. Lets the user watch
 * the agent escalate across retrieval tiers.
 */
export function ToolActivity({ name, state }: { name: string; state: string }) {
    const errored = state === 'output-error'
    const running = state === 'input-streaming' || state === 'input-available'
    const text = errored ? `${name.replace(/_/g, ' ')} failed` : toolLabel(name, !running)

    return (
        <Badge
            variant={errored ? 'destructive' : 'secondary'}
            className={cn(
                'gap-1.5 self-start border-dashed',
                errored ? 'border-destructive/50' : 'border-border',
            )}
        >
            {errored ? (
                <TriangleAlert />
            ) : running ? (
                <Loader2 className="animate-spin" />
            ) : (
                <Check />
            )}
            <span>
                {text}
                {running ? '…' : ''}
            </span>
        </Badge>
    )
}
