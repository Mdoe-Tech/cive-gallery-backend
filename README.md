## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   [Bun](https://bun.sh/) (or npm/yarn/pnpm)
*   [PostgreSQL](https://www.postgresql.org/download/) server running
*   [Redis](https://redis.io/docs/getting-started/installation/) server running (optional, for caching)
*   `ffmpeg` and `ffprobe` (can be installed system-wide or rely on the `ffmpeg-static` and `ffprobe-static` npm packages installed as dependencies).

### Database Setup

1.  Ensure your PostgreSQL server is running.
2.  Create a database for the application (e.g., `cive_gallery`).
3.  Configure the database connection details in your `.env` file (see Environment Variables section).
4.  Run TypeORM migrations to create the necessary tables:
    ```bash
    # If using TypeORM CLI configured in package.json
    bun run typeorm:migration:run
    # or: npm run typeorm:migration:run / yarn typeorm:migration:run
    ```
    *(Adjust the script name based on your `package.json`)*

### Redis Setup (Optional but Recommended)

1.  Ensure your Redis server is running (usually on `localhost:6379` by default).
2.  The application will connect using the `REDIS_URL` specified in the `.env` file.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Mdoe-Tech/cive-gallery-backend.git
    cd cive-gallery-backend
    ```
2.  **Install dependencies:**
    ```bash
    bun install
    # or: npm install / yarn install / pnpm install
    ```
3.  **Install necessary binaries (if not system-wide):** The `ffmpeg-static` and `ffprobe-static` packages should handle this during `bun install`.

### Environment Variables

1.  **Copy the example file:**
    ```bash
    cp .env.example .env
    ```
2.  **Edit `.env`:**
    Fill in the required values, **especially**:
    *   `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`
    *   `REDIS_URL` (if using Redis)
    *   `PORT` (e.g., 5050)
    *   `FRONTEND_URL` (e.g., `http://localhost:3000`)
    *   `JWT_SECRET` ( **Generate a strong, unique secret!** )
    *   `JWT_EXPIRES_IN`
    *   `EMAIL_SERVICE`, `EMAIL_USER`, `EMAIL_PASS` (Use an App Password for Gmail if 2FA is enabled)

### Running the Application

#### Development Mode

*   Includes hot-reloading.
    ```bash
    bun run start:dev
    # or: npm run start:dev / yarn start:dev
    ```

#### Production Mode

1.  **Build the application:**
    ```bash
    bun run build
    # or: npm run build / yarn build
    ```
2.  **Start the production server:**
    ```bash
    bun run start:prod
    # or: npm run start:prod / yarn start:prod
    ```

## Modules Overview

*   **AuthModule:** Handles user authentication (JWT strategy, login, registration, password reset, profile fetching) and authorization setup (guards).
*   **UsersModule:** Manages user data fetching (lists, search) primarily for administrative purposes.
*   **GalleryModule:** Manages gallery item uploads, approvals, metadata, and potentially searching (delegated to SearchModule).
*   **EventsModule:** Manages event creation, updates, status changes, and retrieval.
*   **UpdatesModule:** Manages creation, updates, approval, and retrieval of announcements/updates, including attachment handling and downloads.
*   **NotificationsModule:** Core module for creating, storing, and delivering notifications via database, email (Nodemailer), and WebSockets (Socket.IO). Manages user preferences.
*   **SearchModule:** Provides unified search across modules, autocomplete, suggestions, sharing links, and annotation handling. Uses caching.
*   **CommonModule:** Contains shared utilities, interfaces (like `UserRole`), base DTOs, etc. (Assumed structure).
*   **AppModule:** The root module, importing all feature modules and configuring global providers (ConfigModule, TypeOrmModule, CacheModule).

## Authentication

*   Uses Passport.js with the `passport-jwt` strategy.
*   Expects a JWT in the `Authorization: Bearer <token>` header for protected routes.
*   `JwtAuthGuard` protects routes globally or individually.
*   `RolesGuard` works with the `@Roles()` decorator for RBAC.

## File Uploads

*   Handled via `FilesInterceptor` from `@nestjs/platform-express` and `multer`.
*   Files are currently stored locally in the `./uploads/` directory (separated by type: `updates`, `gallery/media`, `gallery/thumbnails`). **This directory should typically not be committed to git.**
*   Basic validation for file size and MIME type is performed using `ParseFilePipe`.
*   Static file serving is configured in `main.ts` under the `/uploads/` prefix.

## Real-time Notifications

*   `NotificationsGateway` manages Socket.IO connections under the `/notifications` namespace.
*   Requires JWT authentication via the `auth.token` payload during the WebSocket handshake.
*   Pushes `newNotification` events to specific users upon creation of relevant notifications.
*   (Future enhancement) Can push `unreadCountUpdate` or other specific events.

## Caching

*   Uses `@nestjs/cache-manager` potentially configured with a Redis adapter (based on `REDIS_URL` env var).
*   `SearchService` utilizes caching for search results, autocomplete, and suggestions to reduce database load. Cache TTL is configurable via `.env`.

## Database Migrations (TypeORM)

*   Assumes TypeORM CLI is configured in `package.json`.
*   Use `bun run typeorm:migration:generate src/database/migrations/YourMigrationName` to create new migrations after entity changes.
*   Use `bun run typeorm:migration:run` to apply pending migrations.
*   Use `bun run typeorm:migration:revert` to undo the last migration.

## Linting & Formatting

*   **ESLint:** Run `bun run lint` to check for code style issues.
*   **Prettier:** Run `bun run format` to automatically format code.

## Contributing


Please refer to `CONTRIBUTING.md`.

## License

MIT License.
