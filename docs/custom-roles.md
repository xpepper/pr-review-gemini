# Custom review roles

Custom roles add domain-specific reviewer lenses alongside (or instead of)
the six standard lenses: `correctness`, `contracts`, `security`,
`performance`, `conventions`, `tests`. A role is a configured prompt with
optional model settings; the engine schedules and runs it exactly like a
standard lens, in parallel, with its own findings tagged by role id.

## Configuration

Define roles under `custom_roles` (aliases: `customRoles`, `roles`) in
`.github/gem-pr-review.json` (project) or `~/.copilot/gem-pr-review.json`
(user). Project configuration overrides user configuration; runtime
arguments override both.

Each role object accepts:

| Property | Values |
| --- | --- |
| `prompt` (or `instructions`) | Required. The reviewer instructions; one of the two is enough — the other is derived. |
| `name` | Optional display name; defaults to a title-case form of the role id. |
| `description` | Optional short description. |
| `model` | Optional model id; falls back through the tier's model. |
| `reasoningEffort` | `off`, `low`, `medium`, `high`. |
| `tier` | `light`, `medium`, `heavy`. |
| `fallbacks` | Ordered list of fallback model ids for quota/capacity errors. |

Per-role overrides can also come from the shared `lenses` map
(`lenses: { "<roleId>": { model, reasoningEffort, tier, fallbacks } }`),
which takes precedence over the role's own values.

## Scheduling semantics

- **Default:** the review mode's standard lenses run, and custom role ids
  are appended.
- **`enabled_roles` (alias `enabledRoles`) or an explicit `roles` list:**
  exactly that list runs — standard lenses and/or custom roles. An unknown
  id fails the review with `Unknown review role: "<id>"`.
- **`replace_standard_roles` (alias `replaceStandardRoles`):** when `true`,
  only the custom roles run.

A `custom_roles` entry whose key matches a standard lens id will
**override the standard** lens definition with its prompt and model
settings.

## Example

Mount a domain-specific database reviewer alongside the standard lenses:

```json
{
  "custom_roles": {
    "db": {
      "name": "Database Migrations",
      "prompt": "Review migration files for backwards compatibility, index usage, and lock behavior. Flag destructive operations that need a two-step deploy.",
      "tier": "heavy"
    }
  }
}
```

Run only the security lens and the `db` role:

```bash
node scripts/dogfood-review.mjs 42 --role security,db
```

Run only custom roles (no standard lenses):

```bash
node scripts/dogfood-review.mjs 42 --replace-standard-roles
```

## Trust boundary

Custom role instructions are injected as untrusted content: they are
sandboxed in the reviewer prompt and cannot modify, override, or relax the
core reviewer safety policies (severity contract, anchoring rules,
publishing gates). Prototype-pollution keys (`__proto__`, `prototype`,
`constructor`) are rejected.

## Where roles are accepted

- CLI: `--role <id>` (repeatable or comma-separated) and
  `--replace-standard-roles` on `scripts/dogfood-review.mjs` and
  `scripts/self-review.mjs`; the `/gem-review` comment command accepts the
  same flags.
- MCP: `roles`, `replaceStandardRoles`, and `customRoles` parameters on
  `gem_pr_review_subagents`, `gem_self_review`, and `gem_pr_review_self`
  (see the [MCP tools reference](mcp-tools.md)).
