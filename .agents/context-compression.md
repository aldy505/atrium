# Context Compression Playbook

## Trigger

- Compress when active context reaches 70-80% utilization
- Compress sooner when artifact trail starts drifting

## Optimization Target

- Optimize for **tokens per task**
- Reject summaries that force re-fetching key details

## Required Summary Sections

- `Session Intent`
- `Files Created`
- `Files Modified`
- `Files Read`
- `Decisions Made`
- `Current State`
- `Open Errors`
- `Next Steps`

## Compression Method

- Use anchored iterative summarization
- Summarize only newly truncated span
- Merge into existing structured summary
- Do not regenerate full summary each cycle

## Artifact Trail Rules

- Keep exact file paths
- Keep symbol/function names
- Keep command outputs that changed decisions
- Keep failing test names and error strings

## Probe Checks After Compression

- Recall: original error message is recoverable
- Artifact: modified file list is complete
- Continuation: next step list is actionable
- Decision: rationale for major choices is preserved

## Handoff Template

```markdown
## Session Intent

-

## Files Created

-

## Files Modified

-

## Files Read

-

## Decisions Made

-

## Current State

-

## Open Errors

-

## Next Steps

1.
2.
3.
```

## Skill References

- `.agents/skills/context-engineering-collection/skills/context-compression/SKILL.md`
- `.agents/skills/context-engineering-collection/skills/context-degradation/SKILL.md`
- `.agents/skills/context-engineering-collection/skills/evaluation/SKILL.md`
