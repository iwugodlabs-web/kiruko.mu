import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

interface TokenPayload {
    user: {
        user_id: number;
        email: string;
        user_type?: 'company' | 'private';
        roles?: string[];
        is_superuser?: boolean;
        // Set by the backend at login when COMPANY_RBAC_ENABLED is on AND this
        // private user holds a company management role (HR, etc.). Lets a
        // delegated manager into /dashboard without exposing the flag to the web.
        company_web_access?: boolean;
    }
}

// Routes config
const PROTECTED_ROUTES = [
    {
        path: '/admin',
        role: 'platform_admin' // or is_superuser
    },
    {
        path: '/dashboard',
        role: 'authenticated'
    }
];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 1. Check if public route
    if (
        pathname.startsWith('/_next') ||
        pathname.startsWith('/api') ||
        pathname.startsWith('/static') ||
        pathname === '/' ||
        pathname === '/manifest.json' ||
        pathname.startsWith('/accept-invite')
    ) {
        return NextResponse.next();
    }

    // 2. Get Cookie
    const tokenCookie = request.cookies.get('access_token');
    const token = tokenCookie?.value?.replace('Bearer ', '');

    // Check if current path requires protection
    const protectedRoute = PROTECTED_ROUTES.find(r => pathname.startsWith(r.path));

    if (protectedRoute && !token) {
        // Redirect to login (root) if accessing protected route without token
        return NextResponse.redirect(new URL('/', request.url));
    }

    if (!token) {
        return NextResponse.next();
    }

    // 3. Verify token signature + audience. The middleware is a real security
    //    boundary now, not a UX hint — a forged or mobile-origin token can no
    //    longer render the admin shell.
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
        console.error('Middleware: JWT_SECRET is not set; failing closed.');
        if (protectedRoute) {
            return NextResponse.redirect(new URL('/', request.url));
        }
        return NextResponse.next();
    }

    try {
        const secret = new TextEncoder().encode(jwtSecret);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ['HS256'],
            audience: 'web',
        });

        const user = (payload as any).user as TokenPayload['user'];
        const isSuperUser = user?.is_superuser === true;
        const roles = user?.roles || [];
        const userType = user?.user_type;

        // Block employees (private users) from the entire web dashboard.
        // Web is for company/employer accounts only — EXCEPT platform admins,
        // who are seeded with user_type='private' (see super_admin_seeder.py)
        // and would otherwise be unable to reach /admin. This must mirror the
        // carve-out in src/contexts/AuthContext.tsx :: isPrivateUserBlocked.
        if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) {
            if (userType === 'private') {
                const isPlatformAdmin = isSuperUser || roles.includes('platform_admin');
                // A delegated company manager (RBAC on) carries company_web_access
                // in the token and may use /dashboard (not /admin — that stays
                // platform-admin only via the role check below).
                const hasCompanyWebAccess =
                    user?.company_web_access === true && pathname.startsWith('/dashboard');
                if (!isPlatformAdmin && !hasCompanyWebAccess) {
                    return NextResponse.redirect(new URL('/', request.url));
                }
            }
        }

        // Role check for /admin routes — must hold the literal platform_admin
        // role (or be a superuser). Earlier this accepted any non-empty roles
        // array, which let unrelated roles through.
        if (protectedRoute?.role === 'platform_admin') {
            const hasPlatformAccess = isSuperUser || roles.includes('platform_admin');

            if (!hasPlatformAccess) {
                return NextResponse.redirect(new URL('/dashboard', request.url));
            }
        }

    } catch (e) {
        console.error("Middleware JWT verification failed:", e);
        // Invalid token (bad signature, wrong audience, expired, etc.) -> login
        return NextResponse.redirect(new URL('/', request.url));
    }



    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
