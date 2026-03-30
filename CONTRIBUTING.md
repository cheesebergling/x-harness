# Contributing to x-harness

Thank you for your interest in contributing to x-harness! 🎉

## How to Contribute

### Reporting Bugs

1. Check existing [Issues](https://github.com/cheesebergling/x-harness/issues) first
2. Create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node.js version, OS, Wrangler version)

### Suggesting Features

Open an issue with the `feature-request` label and describe:
- The use case
- Proposed API / behavior
- Why it benefits the community

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Follow the existing code style (TypeScript, Hono)
4. Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/)
5. Ensure the project builds: `npx wrangler deploy --dry-run`
6. Submit a PR against `main`

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/x-harness.git
cd x-harness

# Install dependencies
npm install

# Copy environment template
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your credentials

# Run locally
npm run dev

# Dashboard development
cd dashboard && npm install && npm run dev
```

## Code Style

- **Language**: TypeScript (strict mode)
- **Framework**: Hono v4 for API routes
- **Database**: Cloudflare D1 with parameterized queries
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`)

## Project Structure

```
x-harness/
├── src/              # Cloudflare Worker source
│   ├── routes/       # API route handlers
│   ├── services/     # Business logic
│   ├── middleware/    # Auth, validation
│   ├── db/           # D1 migrations
│   └── types/        # TypeScript types
├── dashboard/        # React dashboard (Vite)
├── mcp/              # MCP server for AI agents
└── docs/             # Documentation
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
