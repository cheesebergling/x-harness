# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-03-30

### Added
- DM caching system with D1 storage for reduced API costs
- Batch AI bookmark analysis (up to 100 items)
- Enhanced AI skill extraction with GitHub/AI-tool pattern detection
- File System Access API integration for local sync
- GitHub Actions CI workflow

### Fixed
- Scheduled posts/actions timezone mismatch — `scheduled_at` now normalized to UTC ISO string

### Changed
- Improved DM template and auto-reply error handling via database migration
- Upgraded stealth mode with enhanced ghost character patterns
- Workflow automation feature deferred to next release

## [0.7.0] - 2026-03-29

### Added
- Worker mode with Promise.allSettled for robust parallel operations
- Idempotent scheduled actions (repost, like)
- Event-based local sync triggers
- Dashboard refresh buttons for all modules

### Changed
- Switched from polling to event-driven sync architecture

## [0.6.0] - 2026-03-29

### Added
- Writing Rules system (CRUD + default selection)
- Local Sync (Syncthing-style data export)
- Lucide icon integration in dashboard
- AI Manual and User Manual documentation

### Changed
- Dashboard redesigned with modern icon system

## [0.5.0] - 2026-03-28

### Added
- Deploy-first architecture on Cloudflare Workers
- MCP Server with 21 tools for Claude Code / Antigravity
- HARNESS_API_KEY authentication (Bearer Token)
- OAuth 2.0 PKCE flow with automatic token refresh
- Tweet management (post, thread, delete, schedule)
- Analytics (impressions, engagement, followers)
- DM management (read, send, stealth bulk send)
- Bookmark management with AI analysis
- API cost tracking with Discord notifications
- React dashboard with Vite

## [0.1.0] - 2026-03-28

### Added
- Initial project setup
- Basic X API v2 integration
