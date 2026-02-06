# @mcp-layer/error

Custom error class for mcp-layer packages.

The implementation follows the same mechanics as `@bento/error`:

- deterministic short hashtag from `name + method + message`,
- source context in the message (`@scope/package(method)`),
- generated docs URL tied to the thrown error identity,
- support for named placeholder interpolation via `vars`,
- passthrough custom fields on the error instance.

No support-channel line is appended.

## Installation

```sh
pnpm add @mcp-layer/error
```

## API Reference

### `new LayerError(args)`

```js
new LayerError({
  name: 'manager',
  method: 'identity',
  message: 'Authorization header is required.',
  vars: {},
  docs: 'github.com/3rd-Eden/mcp-layer/tree/main/packages',
  scope: '@mcp-layer',
  ...customFields
});
```

Required:

- `name`
- `method`
- `message`

Optional:

- `vars` for named replacement in `message` (for example `{ server: 'demo' }` for `Server "{server}" was not found.`)
- `args` for legacy positional `%s` replacement in `message`
- `docs` base path override
- `scope` override
- any other custom fields (`status`, `cause`, etc), copied to the error object

### `hashtag(message)`

Generates the short deterministic reference hash.

### `docs(args)`

Builds the package README error URL:

`https://<docs>/<package>/README.md#error-<hash>`

## Example

This example shows the intended throw pattern. It matters because the error always contains package/method context and a deterministic URL for remediation.

Expected behavior: message contains `@mcp-layer/manager(identity)` and a URL to the manager README error section.

```js
import { LayerError } from '@mcp-layer/error';

throw new LayerError({
  name: 'manager',
  method: 'identity',
  message: 'Authorization header is required.'
});
```
