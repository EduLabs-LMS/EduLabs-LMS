# Learning Management System

A new multi-tenant Learning Management System built with Next.js, Firebase Authentication and Supabase PostgreSQL, reusing the original website's adapted frontend design.

The EduLabs redesign is documented in [visual integration and acceptance](docs/edulabs-visual-redesign.md). Its public reference page is `/design-preview`; `/` keeps its existing authenticated behavior. The new LMS supports English/Arabic, RTL and light/dark presentation.

**Active direction:** no legacy data migration or Clerk identity linking. See [the new LMS Phase 2 plan](docs/new-lms-phase2.md) for completed functionality, verification and the next teacher-editor slices. Historical feature/setup notes below may describe dormant Clerk/Prisma code retained for a later reviewed cleanup.

The frontend and backend have distinct code layers within one Next.js deployment. See [the architecture guide](docs/architecture.md) for request flow, dependency rules, and how to add features.

The new multi-teacher Supabase database foundation is documented in
[database architecture](docs/database-architecture.md). Versioned SQL is in
`supabase/migrations/`, development fixtures in `supabase/seed.sql`, and executable
RLS checks in `supabase/tests/authorization.sql`. Typed browser/server Supabase
clients use the public URL and publishable key from `.env.local` (see `.env.example`).
The adapted website uses Firebase/Supabase in the explicitly selected development mode. Existing Clerk/Prisma branches remain isolated; do not run legacy migration tooling or alter the old database.

[Live Demo](https://lms.shounoop.vercel.app)

---

## Table of Contents

- [Learning Management System](#learning-management-system)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Environment Variables](#environment-variables)
    - [Database Setup](#database-setup)
    - [Running Locally](#running-locally)
  - [Database Schema](#database-schema)
  - [Folder Structure](#folder-structure)
  - [Contribution](#contribution)
  - [License](#license)
  - [Contact \& Links](#contact--links)

---

## Features

- User authentication and authorization (Clerk)
- Course creation, editing, and management
- Chapter and lesson organization
- Video streaming (Mux integration)
- File uploads and attachments
- Student progress tracking
- Exams, quizzes, and feedback
- Chapter progress and homework submission tracking
- Dashboard analytics
- Responsive, modern UI (Tailwind CSS)

---

## Tech Stack

- **Frontend:** Next.js, React, Tailwind CSS, Radix UI, Clerk Auth
- **Backend:** Next.js API routes, Prisma ORM
- **Database:** PostgreSQL
- **Video:** Mux
- **Other:** Zustand, Zod, React Hook Form, UploadThing, LiveKit

---

## Getting Started

### Prerequisites
- Node.js >= 22 (required by the current Supabase client)
- PostgreSQL database
- [Mux](https://mux.com/) and [Clerk](https://clerk.dev/) accounts for full functionality

### Installation

```bash
git clone https://github.com/shounoop/learning-management-system.git
cd learning-management-system
npm install
```

### Environment Variables

Create a `.env` file in the root directory and add the following:

```
DATABASE_URL=your_postgres_connection_string
DATABASE_URL_UNPOOLED=your_direct_postgres_connection_string
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
MUX_TOKEN_ID=your_mux_token_id
MUX_TOKEN_SECRET=your_mux_token_secret
UPLOADTHING_TOKEN=your_uploadthing_token
```

### Database Setup

```bash
npx prisma generate
npx prisma migrate deploy
```

### Running Locally

```bash
npm run dev
```

On Windows, the npm scripts preload a narrow filesystem compatibility fix for
exFAT drives: Node reports `EISDIR` when reading a non-symlink, while Next.js expects
`EINVAL`. The fix verifies that the path is not a link before normalizing this error;
other errors are preserved. This avoids the [known exFAT build issue](https://github.com/vercel/next.js/discussions/38785)
when running this checkout on `D:`. Linux/macOS behavior is unchanged.

---

## Database Schema

![Database Schema](https://github.com/shounoop/learning-management-system/assets/85869774/42c64380-bdf3-40f1-a5b6-07dcb835eb4a)

See [`prisma/schema.prisma`](prisma/schema.prisma) for details.

---

## Folder Structure

```
├── app/             # Next.js routing, server composition, and API adapters
├── frontend/        # Components, feature views, hooks, and browser API client
├── server/          # HTTP handlers, queries, services, integrations, and Prisma client
├── shared/          # Presentation contracts, constants, and pure utilities
├── prisma/          # Database schema
├── public/          # Static assets (images, icons)
├── scripts/         # Utility scripts and validation
├── docs/            # Architecture and development guidance
```

Run `npm run check` for backend/architecture tests, dependency checks, TypeScript,
and lint. Run `npm run build` to validate a production build; it also enforces
the frontend/backend boundaries.

The website remains on Clerk/Prisma/UploadThing. Supabase LMS access is prepared
behind a disabled staging flag until the separate identity migration. Read the
[verified Supabase report](docs/supabase-completion-report.md),
[operations guide](docs/database-operations.md),
[identity transition](docs/identity-transition.md), and
[legacy migration mapping](docs/legacy-data-migration.md).
`npm run test:lms-http` checks anonymous/token API boundaries; the opt-in
`npm run test:lms-load` requires dedicated real development sessions.

---

## Contribution

Dependency remediation is documented in the [security report](docs/dependency-security-report.md)
and [complete advisory inventory](docs/dependency-advisory-inventory.md).
For the read-only local runtime checks, start a production build with
`npm run start -- --hostname localhost --port 3108`, then run
`npm run test:security-smoke` in another terminal. Use Node 22 or newer.

Contributions are welcome! Please open an issue or submit a pull request.

---

## License

MIT

---

## Contact & Links

- Author: [shounoop](https://github.com/shounoop)
- [Project Repository](https://github.com/shounoop/learning-management-system)
- [Live Demo](https://lms.shounoop.vercel.app)
