import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatComposer } from './ChatComposer'

const noop = () => {}

describe('<ChatComposer />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('submits trimmed text and clears the input', async () => {
        const onSend = vi.fn()
        render(<ChatComposer onSend={onSend} streaming={false} onStop={noop} />)
        const input = screen.getByLabelText('Message')

        fireEvent.change(input, { target: { value: '  a clever heist movie  ' } })
        const send = screen.getByRole('button', { name: 'Send' })
        await waitFor(() => expect(send).not.toBeDisabled())
        fireEvent.click(send)

        await waitFor(() => expect(onSend).toHaveBeenCalledWith('a clever heist movie'))
    })

    it('submits on Enter but not on Shift+Enter', async () => {
        const onSend = vi.fn()
        render(<ChatComposer onSend={onSend} streaming={false} onStop={noop} />)
        const input = screen.getByLabelText('Message')

        fireEvent.change(input, { target: { value: 'dune' } })
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        expect(onSend).not.toHaveBeenCalled()

        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(onSend).toHaveBeenCalledWith('dune'))
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('keeps Send disabled while the input is empty', () => {
        render(<ChatComposer onSend={noop} streaming={false} onStop={noop} />)
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    })

    it('shows a Stop button while streaming and calls onStop', () => {
        const onStop = vi.fn()
        render(<ChatComposer onSend={noop} streaming onStop={onStop} />)
        const stop = screen.getByRole('button', { name: 'Stop' })
        fireEvent.click(stop)
        expect(onStop).toHaveBeenCalledOnce()
        expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    })
})
