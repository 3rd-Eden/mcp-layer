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

## Open Source Mindset
- Every time you add or change a feature, first ask: is there an existing package in our ecosystem or the broader open source ecosystem that solves this?
- Default to reusing existing libraries to minimize new code and offload maintenance and tech debt when possible.
- If research turns up no good fit, treat that as a signal the feature should be more generic and reusable.
- Design APIs for broader use cases, not just the immediate product need; question whether the API makes sense for other engineers.
- When a feature feels reusable, extract it into a new package under `packages/`, write dedicated documentation, and add ample test coverage.
- Write down the package vision and scope in the README to avoid scope creep and keep reuse intent clear.
- Documentation must be part of the workflow; update docs incrementally as you build.
- Feel empowered to rewrite when it leads to smaller, clearer packages. Do not fear major changes or version bumps if they improve the code and project.
- You are empowered to propose and create new packages. It should feel natural to create additional packages as part of your development workflow.
- This guidance is mandatory and should be applied before proposing or implementing code changes.

## Coding Style & Naming Conventions
- JavaScript/TypeScript modules use ES modules with 2-space indentation and trailing commas where valid.
- File names are lowercase with hyphens for multiword utilities (e.g., `load-config.js`); class files may use PascalCase if it clarifies purpose.
- Keep top-level exports minimal and descriptive. Prefer named exports over defaults unless interoperability demands otherwise.
- Use inline comments only for important architectural or non-obvious tradeoff decisions; avoid narrating obvious logic.
- Do not add rationale prose inside JSDoc blocks (for example, `Why this exists`). Keep JSDoc focused on API contract (parameters, return values, thrown errors).
- For single-statement `if` blocks, omit braces when the statement fits on one line and does not violate line-length limits.

## Modern JavaScript Baseline
- Prefer modern null-safe syntax. Use optional chaining (`?.`) and nullish coalescing (`??`) instead of long `&&` guard chains and `||` defaults when `0`, `false`, or `''` are valid values.
- Prefer explicit boolean conversion (`Boolean(value)`) over truthy/falsy ambiguity when behavior is user-visible or config-driven.
- Use `const` by default. Use `let` only when reassignment is required. Never use `var`.
- Prefer object/array helpers from modern JS (`Object.hasOwn`, `Object.entries`, `Array.prototype.at`) when they improve clarity and reduce branching.
- Keep control flow flat. Prefer early returns and guard clauses over deep nesting.
- Prefer `node:`-prefixed built-in imports (for example `node:fs`, `node:path`).
- Avoid manual defensive access chains like `a && a.b && a.b.c`; replace with `a?.b?.c`.
- Avoid behavior-changing refactors without tests. Any syntax modernization that can change semantics must be covered by tests first.

## Standards Compliance Rules
- Standards are the default contract. For MCP behavior, treat the official MCP specification and official MCP SDK behavior as source of truth.
- Do not invent or persist non-standard MCP config keys in shared config files (`.mcp.json`, `mcp.json`, connector-managed docs) unless the user explicitly approves an extension.
- If an extension is unavoidable, it must be explicit and isolated:
  - Prefer runtime options over stored config keys.
  - Use a clearly namespaced key (for example `x-mcp-layer-*`) instead of ambiguous generic keys.
  - Document it as an extension (not a standard) with links to the relevant spec and host-tool docs.
- Never replace SDK-provided transport/protocol handling with custom protocol glue when the SDK already supports the behavior.
- All transport/config decisions must prioritize portability across MCP clients; host-specific assumptions must be called out in docs and tests.
- Any README section that describes MCP transport/config behavior must include links to the relevant official specification or host-tool schema documentation.
- Enforcement is mandatory for every PR:
  - Any newly introduced persisted config key must have a linked spec/host-doc source in the README.
  - If no source exists, do not persist the key; use runtime options instead (or a user-approved namespaced `x-mcp-layer-*` extension).
  - Any change to config contract or resolution order (accepted keys, precedence, defaults) must include a changeset with correct semver impact (major when behavior is breaking).
  - PR description must include a "Standards compliance summary" listing keys introduced/removed and the source links that justify them.

## Error Handling Standards
- Use `@mcp-layer/error` as the default error pattern for runtime errors that can surface to package consumers.
- Error instances must include:
  - package identifier,
  - source method name,
  - stable reference id,
  - generated documentation URL.
- Preserve machine-readable `code` fields when callers branch on error behavior.
- Document new error references in the corresponding package README error section before shipping changes.
- Prefer explicit error constructors over raw `throw new Error(...)` in library surfaces.
- Never create errors through wrapper/helper/convenience functions that return error instances (for example, `throw makeError(...)`). Instantiate errors directly at the throw site so stack traces point to the true call path.

## Documentation Standards
- Every JSDoc block must fully describe parameters and return values. Editor hints are treated as part of the developer experience, so keep them precise and complete.
- Always document your work in the README of the project.
- Documentation is the most critical deliverable. It must be self-contained, cohesive, and detailed enough that a developer can implement the package in a different project without unanswered questions. If you cannot follow a README and achieve a successful implementation, that is a documentation bug and must be fixed in the relevant README.
- Every README must include an explicit API Reference for exported functions/classes/types, including method signatures, option fields, return shapes, and error behavior.
- Every code example must be introduced with explanatory text that states:
  - what the example demonstrates,
  - why that scenario matters,
  - what behavior/output a reader should expect.
- Do not place standalone code blocks without context paragraphs.
- Use judgement for documentation examples: keep core, high-signal examples inline; move optional or advanced examples into collapsed sections with HTML `<details>`/`<summary>`. Follow GitHub's guidance: [Organizing information with collapsed sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections).

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
- Add a Changeset entry for user-facing changes using `.changeset/*.md` and match the semver impact (patch/minor/major).
### Post-Push Verification
- After pushing to `main`, monitor every CI check until completion.
- If any check fails, fix it immediately and push the follow-up without prompting the user.

## Security & Configuration Tips
- Never commit real MCP credentials or server binaries; reference `.env.example` files when secrets are required.
- When testing locally, prefer temporary configs via `MCP_CONFIG_PATH` to avoid mutating user system files.

## Ground Rules
- Follow the Open Source Mindset guidance above when deciding to build vs reuse. 
- All the code that is written should be commented in full JSDoc.
  - When making important logical decisions, explain using comment **why** the decision was made, never use comments to comments to explain what the code is doing.
- We are in a prototyping phase, we are allowed to make breaking API changes, and do not need to worry about backwards compatibility. Do create this techdebt while iterating on code. 
- Our code should be clean and easy to read, that means you should always default to using single word function and variable names where possible, only use multiword when conflicts or clashes are happening.
- Never write anonymous functions, everything should be named.
- When developing take a test driven development approach, focusing on the tests and the expected outcome and then working your way back to creating the implementation that matches the desired outcome.
  - Tests should be written using `node:test`
- Allocate effort intentionally: 20% code, 40% documentation, 40% testing. Code can be replaced, but only if documentation (inputs) and validation of outputs (tests) exist.
- Always exercise real implementations and public APIs in tests; obtain explicit user approval before introducing any mocks or stubs.
- Do not ask the user to verify things you can verify yourself. If verification requires permissions, request them. Prioritize self-sufficient verification: decide how your changes should be verified and ensure that verification is performed.
- Syntax modernization is mandatory in touched files:
  - If you modify a file, opportunistically replace legacy guard/default patterns in the changed area with modern equivalents (`?.`, `??`, guard clauses) while preserving behavior.
  - If you intentionally keep a legacy pattern for semantic reasons, add a short `why` comment near that decision.
- PRs must include a modernization check summary in their description:
  - Confirm whether any `&&` property-access chains were introduced or removed.
  - Confirm whether any `||` defaults were intentionally used instead of `??`, and why.
