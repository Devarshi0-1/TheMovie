import { Link, useRouterState } from '@tanstack/react-router'
import { Bookmark, Compass, MessageCircle, Tv } from 'lucide-react'
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar'

// Primary destinations for the app shell. Discover matches `/` exactly; the
// others are prefix-active (so `/movie/:id` keeps Discover lit, etc.).
const NAV_ITEMS = [
    { to: '/', label: 'Discover', icon: Compass, exact: true },
    { to: '/tv', label: 'TV Shows', icon: Tv, exact: false },
    { to: '/chat', label: 'Chat', icon: MessageCircle, exact: false },
    { to: '/watchlist', label: 'Watchlist', icon: Bookmark, exact: false },
] as const

function isActive(pathname: string, to: string, exact: boolean): boolean {
    return exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`)
}

/**
 * The app shell's left navigation, built on the shadcn `Sidebar` (collapsible to
 * an icon rail). Brand → primary nav (Discover / Chat / Watchlist) with
 * router-driven active state → session controls in the footer.
 */
export function AppSidebar() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })

    return (
        <Sidebar collapsible="icon" variant="sidebar">
            <SidebarHeader className="h-14 justify-center border-b px-2">
                <SidebarMenuButton asChild className="font-bold tracking-tight">
                    <Link to="/">
                        <span className="text-lg" aria-hidden="true">
                            🎬
                        </span>
                        <span className="text-foreground">TheMovie</span>
                    </Link>
                </SidebarMenuButton>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Browse</SidebarGroupLabel>
                    <SidebarMenu>
                        {NAV_ITEMS.map((item) => {
                            const Icon = item.icon
                            const active = isActive(pathname, item.to, item.exact)
                            return (
                                <SidebarMenuItem key={item.to}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={active}
                                        tooltip={item.label}
                                    >
                                        <Link to={item.to}>
                                            <Icon />
                                            <span>{item.label}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            )
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>
        </Sidebar>
    )
}
