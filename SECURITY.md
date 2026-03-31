# Security Policy

## Reporting a Vulnerability

**Please do not open public issues for security vulnerabilities.**

If you discover a security vulnerability in this project, please report it responsibly using one of the following methods:

### GitHub Private Vulnerability Reporting (preferred)

1. Go to the [Security tab](https://github.com/straps-eq/eqemulator-loginserver/security/advisories/new) of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details and submit

This keeps the report private between you and the maintainers until a fix is ready.

### Direct Contact

- **Discord:** Message Straps on the [EQEmulator.dev Discord](https://discord.gg/6T4n3DdPVB)
- **GitHub:** Send a private message via [GitHub](https://github.com/straps-eq)

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial assessment:** Within 1 week
- **Fix timeline:** Depends on severity, but we aim for:
  - **Critical/High:** Patch within 7 days
  - **Medium:** Patch within 30 days
  - **Low:** Next scheduled release

## Scope

This policy covers:
- The web application (`web/`)
- The loginserver Docker configuration (`loginserver/`)
- Federation protocol and sync logic
- Authentication and session management
- Docker Compose infrastructure

## Recognition

We're happy to credit security researchers in our release notes (with your permission).
