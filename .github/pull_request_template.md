## Summary

<!-- Explain final behavior, necessary rationale and known limitations, not editing history. -->
<!-- Link the issue and milestone. Use Closes #N only when its acceptance criteria are satisfied. -->

## Verification

- [ ] `npm test`
- [ ] `npm run build` (includes TypeScript checking)
- [ ] Added or updated the smallest relevant regression check, or explained why none is needed

<!-- Include actual results, the FastAgent version used, and checks not run. -->
<!-- UI changes: include sanitized screenshots and keyboard/IME checks. -->
<!-- Run/control changes: verify switching conversations, background runs and failure recovery. -->
<!-- Distinguish mocked HTTP evidence from authorized real-provider/OAuth/proxy verification. -->

## Review checklist

- [ ] Scope matches the linked issue; behavior changes are separated from unrelated refactoring
- [ ] Model display, actual conversation model and credential resolution remain consistent
- [ ] No keys, auth files, private transcripts, project contents or machine-specific state are included
- [ ] Errors remain visible; failed actions do not silently lose drafts, history or runtime control
- [ ] Relevant product/interaction documentation is accurate
- [ ] The PR has a type label and its issue retains the appropriate milestone/priority

<!-- CODEOWNERS requests reviewers after this configuration is on main. -->
<!-- A maintainer decides when to merge; green CI alone is not merge authorization. -->
