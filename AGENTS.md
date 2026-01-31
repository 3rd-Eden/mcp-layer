# Repository Guidelines

## Project Structure & Module Organization
- Repository is a pnpm workspace; publishable packages live in `packages/*` (currently `config`, `connect`, `test-server`).
- Each package ships its own `package.json`, exports via scoped name (`@mcp-layer/<package>`), and keeps source in `src/`.
- Add future utilities as new packages or subdirectories inside `packages/`, mirroring this layout.
- Tests should live beside the code they exercise using a `*.test.js` suffix (e.g., `packages/connect/test/index.test.js`).

## Build, Test, and Development Commands
- `pnpm install` — install workspace dependencies and generate `pnpm-lock.yaml`.
- `pnpm test` — placeholder; replace with the project test runner when introduced.
- Use `node packages/<layer>/src/index.js` for quick manual checks until build tooling is added.

## Coding Style & Naming Conventions
- JavaScript/TypeScript modules use ES modules with 2-space indentation and trailing commas where valid.
- File names are lowercase with hyphens for multiword utilities (e.g., `load-config.js`); class files may use PascalCase if it clarifies purpose.
- Keep top-level exports minimal and descriptive. Prefer named exports over defaults unless interoperability demands otherwise.
- Document complex control flow with brief inline comments; avoid narrating obvious logic.

## Testing Guidelines
- Adopt Vitest or Node’s built-in test runner when implementing tests; wire the chosen command to `pnpm test`.
- Place test files in a local `test` directory within each package (e.g., `packages/connect/test/index.test.js`).
- Mirror the file under test and suffix with `.test.js`.
- Aim for coverage of configuration fallbacks, transport negotiation, and connection teardown paths.
- Use lightweight fixtures under `packages/<layer>/test/fixtures/` to simulate MCP server manifests.
- Expect a `describe`/`it` structure in tests where the first `describe` names the package and nested `describe` blocks focus on methods or classes that need coverage.
- Prefer writing fixture files to disk, in dedicated `fixtures/` folders inside the test directory.

## Commit & Pull Request Guidelines
- Follow Conventional Commit semantics (`feat:`, `fix:`, `docs:`) to make changelog generation easier.
- Scope commits narrowly; each should introduce one logical change and include necessary tests or docs.
- Pull requests must describe the motivation, summarize implementation details, and call out verification steps (commands run, configs inspected).
- Link to tracked issues when applicable and attach logs or screenshots for UI-adjacent changes.

## Security & Configuration Tips
- Never commit real MCP credentials or server binaries; reference `.env.example` files when secrets are required.
- When testing locally, prefer temporary configs via `MCP_CONFIG_PATH` to avoid mutating user system files.

## Ground Rules
- Always default to using existing open source modules where possible, the less code we write, the less we have to maintain, the more we can focus on features. 
- All the code that is written should be commented in full JSDoc.
  - When making important logical decisions, explain using comment **why** the decision was made, never use comments to comments to explain what the code is doing.
- We are in a prototyping phase, we are allowed to make breaking API changes, and do not need to worry about backwards compatibility. Do create this techdebt while iterating on code. 
- Our code should be clean and easy to read, that means you should always default to using single word function and variable names where possible, only use multiword when conflicts or clashes are happening.
- Never write anonymous functions, everything should be named.
- When developing take a test driven development approach, focusing on the tests and the expected outcome and then working your way back to creating the implementation that matches the desired outcome.
  - Tests should be written using `node:test`
- Always document your work in the README of the project.
- Documentation is the most critical deliverable. It must be self-contained, cohesive, and detailed enough that a developer can implement the package in a different project without unanswered questions. If you cannot follow a README and achieve a successful implementation, that is a documentation bug and must be fixed in the relevant README.
- Always exercise real implementations and public APIs in tests; obtain explicit user approval before introducing any mocks or stubs.
