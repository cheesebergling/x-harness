# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email the maintainer or use [GitHub Security Advisories](https://github.com/cheesebergling/x-harness/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Measures

x-harness implements the following security practices:

- **Timing-safe authentication**: API key comparison uses constant-time comparison to prevent timing attacks
- **Token isolation**: X API tokens are stored in Cloudflare D1 and never exposed to local environments
- **Input validation**: All API endpoints validate type, length, and format
- **HTML sanitization**: Writing Rules are sanitized on save to prevent XSS
- **SQL injection prevention**: All queries use parameterized bindings
- **Path traversal prevention**: Local Sync normalizes paths and validates base directory
- **Symlink detection**: Sync rejects symbolic link targets
- **System directory protection**: Blocks sync to Windows/Linux system paths
- **File size limits**: Sync files capped at 10MB

## Best Practices for Users

- Generate API keys with `crypto.randomBytes(32)` — never use weak keys
- Use Cloudflare's secret management (`wrangler secret put`) for all credentials
- Rotate your `HARNESS_API_KEY` periodically
- Keep `wrangler` and dependencies up to date
