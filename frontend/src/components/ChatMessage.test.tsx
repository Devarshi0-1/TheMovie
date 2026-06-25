import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AppUIMessage } from '../lib/chat'
import { ChatMessage } from './ChatMessage'

const msg = (role: string, parts: unknown[]): AppUIMessage =>
    ({ id: 'm1', role, parts }) as unknown as AppUIMessage

const noop = () => {}

describe('<ChatMessage />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('labels and renders a user text turn', () => {
        render(
            <ChatMessage
                message={msg('user', [{ type: 'text', text: 'hello' }])}
                onToolResult={noop}
            />,
        )
        expect(screen.getByText('You')).toBeInTheDocument()
        expect(screen.getByText('hello')).toBeInTheDocument()
    })

    it('renders an assistant text turn', () => {
        render(
            <ChatMessage
                message={msg('assistant', [{ type: 'text', text: 'Here are three picks.' }])}
                onToolResult={noop}
            />,
        )
        expect(screen.getByText('TheMovie')).toBeInTheDocument()
        expect(screen.getByText('Here are three picks.')).toBeInTheDocument()
    })

    it('renders retrieval tool activity', () => {
        render(
            <ChatMessage
                message={msg('assistant', [
                    { type: 'tool-search_movies_sql', toolCallId: 't1', state: 'output-available' },
                ])}
                onToolResult={noop}
            />,
        )
        expect(screen.getByText('Searched the catalog')).toBeInTheDocument()
    })

    // ── HITL ──────────────────────────────────────────────────────────────
    it('renders the watchlist confirmation prompt for a pending manage_watchlist call', () => {
        render(
            <ChatMessage
                message={msg('assistant', [
                    {
                        type: 'tool-manage_watchlist',
                        toolCallId: 't1',
                        state: 'input-available',
                        input: { action: 'add', movieId: 27205, title: 'Inception' },
                    },
                ])}
                onToolResult={noop}
            />,
        )
        expect(screen.getByRole('button', { name: 'Yes, add it' })).toBeInTheDocument()
    })

    it('renders the settled outcome once the manage_watchlist call resolves', () => {
        render(
            <ChatMessage
                message={msg('assistant', [
                    {
                        type: 'tool-manage_watchlist',
                        toolCallId: 't1',
                        state: 'output-available',
                        input: { action: 'add', movieId: 27205, title: 'Inception' },
                        output: { status: 'added', movieId: 27205, title: 'Inception' },
                    },
                ])}
                onToolResult={noop}
            />,
        )
        expect(screen.getByText(/Added Inception to your watchlist/)).toBeInTheDocument()
        // The pending prompt must NOT also show.
        expect(screen.queryByRole('button', { name: 'Yes, add it' })).not.toBeInTheDocument()
    })

    it('does not crash on non-text/non-tool parts (reasoning, step-start)', () => {
        const { container } = render(
            <ChatMessage
                message={msg('assistant', [
                    { type: 'step-start' },
                    { type: 'reasoning', text: 'x' },
                ])}
                onToolResult={vi.fn()}
            />,
        )
        expect(container).toBeTruthy()
    })
})
