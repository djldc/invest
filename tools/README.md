# Tools

Deterministic scripts for execution tasks (WAT framework Layer 3).

Each script should:
- Do one thing well
- Accept clear inputs (env vars, args, or stdin)
- Print clear output or write to a designated file
- Exit with a non-zero code on failure

Language: Node.js or Python — use whatever fits the task.

## Naming convention
`verb_noun.js` or `verb_noun.py`
Examples: `export_users.js`, `send_newsletter.py`, `migrate_db.js`
