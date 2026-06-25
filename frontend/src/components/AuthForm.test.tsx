import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthForm } from './AuthForm'

function fill(label: RegExp | string, value: string) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('<AuthForm />', () => {
    // ── Feature / happy path ──────────────────────────────────────────────
    it('submits valid sign-in credentials', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        render(<AuthForm mode="signin" onSubmit={onSubmit} />)
        fill('Email', 'ana@example.com')
        fill('Password', 'secret123')
        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith({
                email: 'ana@example.com',
                password: 'secret123',
            }),
        )
    })

    it('includes the name field only in sign-up mode and submits it', async () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined)
        render(<AuthForm mode="signup" onSubmit={onSubmit} />)
        expect(screen.getByLabelText('Name')).toBeInTheDocument()
        fill('Name', 'Ana')
        fill('Email', 'ana@example.com')
        fill('Password', 'secret12345')
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith({
                name: 'Ana',
                email: 'ana@example.com',
                password: 'secret12345',
            }),
        )
    })

    // ── Edge cases ────────────────────────────────────────────────────────
    it('blocks submit and shows a field error for an invalid email', () => {
        const onSubmit = vi.fn()
        render(<AuthForm mode="signin" onSubmit={onSubmit} />)
        fill('Email', 'not-an-email')
        fill('Password', 'secret123')
        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
        expect(screen.getByText('Enter a valid email address')).toBeInTheDocument()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('enforces the 8-character password minimum on sign-up', () => {
        const onSubmit = vi.fn()
        render(<AuthForm mode="signup" onSubmit={onSubmit} />)
        fill('Name', 'Ana')
        fill('Email', 'ana@example.com')
        fill('Password', 'short')
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
        expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('surfaces a rejected submission as an inline form error', async () => {
        const onSubmit = vi.fn().mockRejectedValue(new Error('Invalid email or password'))
        render(<AuthForm mode="signin" onSubmit={onSubmit} />)
        fill('Email', 'ana@example.com')
        fill('Password', 'wrongpass')
        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
        expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    })
})
