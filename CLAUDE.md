# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EPGStation is a Japanese digital television (DTV) recording management software that provides a web-based interface for managing TV program schedules, recordings, and streaming. It works with Mirakurun or mirakc as the backend for accessing Japanese digital television streams.

## Development Commands

### Setup and Installation
```bash
# Install all dependencies (both server and client)
npm run all-install

# Database operations
npm run orm-gen --db=sqlite3 --name=MigrationName  # Generate migration
npm run orm-run                                    # Run migrations
npm run backup                                     # Backup database
npm run restore                                    # Restore database
```

### Node.js Version Support
- **Supported Versions**: Node.js 18.x - 22.x
- **Recommended**: Node.js 22.x for latest features and performance
- **Docker Images**: Updated to use Node.js 22 (alpine and debian variants)

### Build and Development
```bash
# Development
npm run build          # Build both server and client
npm run build-server   # Build only server (lint + format + compile)
npm run build-client   # Build only client
npm run watch          # Watch server TypeScript files
cd client && npm run watch  # Watch client files

# Code Quality
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
npm run compile        # TypeScript compilation

# Production
npm start             # Start production server
```

### Testing and Validation
```bash
# Always run these before committing changes
npm run lint
npm run format
npm run compile
```

## Architecture

### Backend Structure (Node.js/TypeScript)
- **Layered architecture** with **dependency injection** (Inversify)
- **Express.js** web framework with **OpenAPI/Swagger** documentation
- **TypeORM** for database operations (SQLite3/MySQL/PostgreSQL)
- **Socket.IO** for real-time communication

Key directories:
- `src/model/service/` - Web service layer (API endpoints, streaming, WebSocket)
- `src/model/operator/` - Core business operations (recording, reservations, rules)
- `src/model/db/` - Database entities and migrations
- `src/model/epgUpdater/` - EPG data synchronization
- `src/util/` - Utility functions

### Frontend Structure (Vue.js 2 + Vuetify)
- **Single Page Application** with Vue Router
- **Material Design** components via Vuetify 2
- **TypeScript** throughout

Key directories:
- `client/src/components/` - Reusable UI components organized by feature
- `client/src/views/` - Page components
- `client/src/model/` - Frontend business logic (API clients, state management)

### Database Architecture
- Uses **TypeORM** with migrations in `src/db/migrations/`
- Supports SQLite3 (default), MySQL/MariaDB (production), PostgreSQL (deprecated)
- Key entities: Channel, Program, Reserve, Recorded, Rule, VideoFile

## Configuration

### Main Configuration File
- `config/config.yml` - Primary configuration
- Contains database settings, Mirakurun/mirakc connection, recording paths, encoding profiles
- Use `config/config.yml.template` as starting point

### Database Configuration
- **ormconfig.js** - TypeORM configuration for migrations
- Environment-specific database connection settings

## API and Streaming

### REST API
- OpenAPI 3.0 specification with Swagger UI at `/api/debug`
- Comprehensive endpoints for schedules, reserves, recordings, rules, streaming
- Real-time updates via Socket.IO WebSocket connections

### Video Streaming
- Multiple formats: HLS, MPEG-TS, MP4, WebM
- FFmpeg-based encoding with configurable profiles
- Live TV streaming and recorded content on-demand
- Japanese subtitle support with aribb24.js

## Docker Support

Multiple Dockerfiles available:
- `Dockerfile.alpine` - Smaller image size
- `Dockerfile.debian` - Better compatibility
- Multi-stage builds for production optimization

## Development Notes

### Code Standards
- **Strict TypeScript** configuration
- **ESLint + Prettier** for consistent formatting
- **Dependency injection** pattern throughout backend
- Follow existing patterns when adding new features
- **Timer Types**: Use `NodeJS.Timeout` instead of `NodeJS.Timer` for Node.js 22+ compatibility

### Key Technologies
- Backend: Node.js 18-22, Express.js, TypeORM, Inversify, Socket.IO, log4js
- Frontend: Vue.js 2, Vuetify 2, Vue Router, Axios, HLS.js, mpegts.js
- Video: FFmpeg for processing and streaming

### Mobile and PWA Support
- Progressive Web App with responsive design
- URL schemes for external app integration
- Optimized for iOS/Android devices

## Documentation

Comprehensive documentation in `/doc/`:
- `linux-setup.md` - Installation guide
- `conf-manual.md` - Configuration reference
- `webapi.md` - API documentation
- Component-specific setup guides