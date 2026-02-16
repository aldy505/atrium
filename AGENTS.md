# Agent Instructions

## Package Manager

- Use **pnpm**
- `pnpm install`
- `pnpm dev`
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run fmt`
- `pnpm run build`
- `pnpm run start`

## Required Quality Checks

- Run `pnpm run fmt` before committing code changes.
- Run `pnpm run lint:fix` before committing code changes.
- Keep `pnpm run typecheck` and `pnpm run build` as validation gates.

## Commit Attribution

- AI commits MUST include:

```
Co-Authored-By: (the agent model's name and attribution byline)
```

Example: `Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>`

If you cannot find your model's email, use `noreply@agents.md`.

## Commit Message Notes (Windows)

- On Windows shells, avoid newline escape sequences like `\n` inside commit message arguments.
- Prefer multiple `-m` flags for multi-paragraph commit messages.
- Example:

```bash
git commit -m "feat: short summary" -m "Detail paragraph one" -m "Detail paragraph two" -m "Co-Authored-By: GPT-5.3-Codex <noreply@agents.md>"
```

## Key Conventions

- Stack: React + Fastify + TypeScript in one repo
- Frontend code: `src/app`, `src/components`
- Backend code: `src/server`
- API prefix: `/api/*`
- Session auth: secure cookie + Redis token mapping
- S3 provider config from env only; do not add endpoint/region inputs in UI
- Validate changes with `pnpm run typecheck` and `pnpm run build`

## Local Skills

- Use `agents-md` for agent docs. See `.agents/skills/agents-md/SKILL.md`
- Use `pnpm` for package-manager workflows. See `.agents/skills/pnpm/SKILL.md`
- Use `commit` for commit message format. See `.agents/skills/commit/SKILL.md`
- Use `security-review` for security audits. See `.agents/skills/security-review/SKILL.md`
- Use `vitest` for test patterns. See `.agents/skills/vitest/SKILL.md`
- Use `vercel-react-best-practices` for React/Next performance patterns. See `.agents/skills/vercel-react-best-practices/SKILL.md`
- Use `vercel-composition-patterns` for composition refactors. See `.agents/skills/vercel-composition-patterns/SKILL.md`
- Use `web-design-guidelines` for UI/UX checks. See `.agents/skills/web-design-guidelines/SKILL.md`
- Use `context-engineering-collection` for long-session and agent-system workflows. See `.agents/skills/context-engineering-collection/SKILL.md`

## Context Compression

- Use `context-compression` skill for long sessions. See `.agents/skills/context-engineering-collection/skills/context-compression/SKILL.md`
- Use project playbook: `.agents/context-compression.md`

## Project Docs

- Implementation history: `.agents/docs/implementation-history.md`
- Current handoff state: `.agents/docs/current-state.md`
