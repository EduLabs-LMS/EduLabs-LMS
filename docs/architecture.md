# Current architecture notice — clean foundation, 2026-10-24

The NEW LMS uses Firebase identity and Supabase/PostgreSQL/RLS when its explicit
Firebase/Supabase flags are selected. Clerk/Prisma is a retained fallback, not the
new academic model. See [current architecture](ai/ARCHITECTURE.md), [state](ai/PROJECT_STATE.md)
and [decisions](ai/DECISIONS.md). Legacy teacher presentation has been retired on this
branch; backend operations and student screens remain. The text below records the
original layer refactor and must not be read as the full current authentication,
persistence or test architecture. Some local SQL suites do use disposable databases.

## Historical layer-refactor documentation

# Frontend and backend boundaries

The portal is one Next.js application with three distinct code layers. It still
builds and deploys as one application. Its routes, layout, styles, assets,
authentication provider, and database schema retain their existing behavior.

| Directory | Responsibility |
| --- | --- |
| `frontend/components/` | Reusable presentation components and UI primitives |
| `frontend/features/` | Dashboard, courses, teacher, group, and admin views |
| `frontend/hooks/` | Browser hooks and UI state |
| `frontend/lib/` | Browser API client and upload widgets |
| `server/http/` | HTTP handlers, request authorization, and response handling |
| `server/queries/` | Data loading for pages and HTTP consumers |
| `server/services/` | User synchronization, permission checks, storage cleanup, and course statistics |
| `server/integrations/` | UploadThing server router |
| `server/db.ts` | The server-only Prisma client |
| `shared/contracts/` | Data shapes exchanged with presentation code |
| `shared/constants/`, `shared/*.ts` | Constants and pure utilities usable on either side |
| `app/` | Next.js routing, server-rendered composition, layouts, and global CSS |
| `app/api/` | Thin routing adapters exposing the existing API URLs |
| `prisma/` | PostgreSQL schema and Prisma generation |

## Request flow

Browser operations use `frontend/lib/api.ts` and existing `/api/...` URLs. Next.js
adapters in `app/api/` export handlers from `server/http/`. These backend handlers
own request authorization, persistence, integrations, and HTTP responses. Shared
query functions can be reused by handlers and server-rendered pages; dashboard
course loading has one implementation for both consumers.

Server-rendered pages import query/service functions directly. They do not make
HTTP calls to their own application or instantiate Prisma. They select the view
to render and pass data into frontend components. Page authentication and
redirects remain at the routing boundary; endpoint authorization remains in the
backend handlers.

The backend is intentionally Next.js-hosted: handlers use Next responses and
Clerk's request context. A future independent backend deployment would require
adapting those interfaces and the server-rendered data path.

## Dependency rules

- Frontend modules depend on frontend code and shared contracts/utilities.
- Backend modules depend on backend code and shared code, never frontend views
  or `app/` routing adapters.
- Shared code has no runtime dependency on either application layer.
- Every backend module imports `server-only`. Next.js fails compilation if
  browser code pulls it into a client bundle.
- Pages consume backend queries/services. Persistence and integration code stay
  under `server/`.
- API route files only export backend handlers and literal Next.js route options.
  Keep options such as `dynamic = 'force-dynamic'` in the route file so Next can
  analyze them statically.

`shared/contracts/uploads.ts` is the sole type-only exception: UploadThing's
client widget infers its contract from the backend router. The export is erased
at compilation and brings no backend implementation into browser bundles.

Course presentation contracts are explicit TypeScript interfaces rather than
imports of Prisma models. Keep contract changes intentional when the database
schema evolves. Server component props can contain `Date` values; HTTP JSON
encodes dates as strings. Use `JsonResponse<T>` when typing an HTTP response that
contains dates rather than treating parsed JSON dates as `Date` instances.

## Adding a feature

1. Define or extend the presentation contract in `shared/contracts/`.
2. Implement data loading or operations under `server/queries/` or
   `server/services/`. Keep secrets and SDK clients in server code.
3. For browser operations, add a handler in `server/http/` and export its HTTP
   methods from the corresponding `app/api/.../route.ts` adapter. Authorize the
   operation inside the handler; a page redirect does not protect an endpoint.
4. Build the view under `frontend/features/` and compose it from the route page.
   Reuse `frontend/lib/api.ts` for browser API calls.
5. Run `npm run check` and `npm run build`.

The Tailwind scan includes all of `frontend/` and `app/`. The component generator
aliases in `components.json` target the new frontend and shared locations.

## Validation

`npm run check:boundaries` parses imports and exports, follows runtime browser
dependencies, and rejects forbidden layer dependencies, missing `server-only`
guards, private browser environment references, direct persistence imports from
pages, and business logic in route adapters. It runs before each production
build. `npm test` checks that guard against invalid dependency graphs and verifies
the shared dashboard query and HTTP authorization/error behavior using in-memory
dependencies. No test connects to or mutates the database.

`npm run check` also typechecks and lints all application layers. Jenkins runs
this validation before building. Existing UI lint warnings are reported without
changing the presentation during this refactor.
