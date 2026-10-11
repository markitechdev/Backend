# Project Management: Development Lifecycle & Workflow Standards

**Author:** jhnyz (Project Manager)  
**Classification:** Quality Management & Governance Procedure  
**Date:** 2026-10-11  

---

## 1. Task Lifecycle Statuses

Every task in the IMS project must strictly progress through these 8 discrete lifecycle statuses:

```
[ BACKLOG ]
     |
     v
 [ READY ]  -------->  [ BLOCKED ] (Technical constraint/dependency)
     |                      ^
     v                      |
[ IN PROGRESS ] ------------+
     |
     v
 [ FOR QA ]
     |
     +-------------\
     v              v
[ QA FAILED ]   [ QA PASSED ]
     |              |
     v              v
[ IN PROGRESS ]  [ DONE ]
```

### Definitions:
1. **BACKLOG:** Task is documented, priority assigned, and logged in the system backlog, but not yet scheduled for an active sprint.
2. **READY:** Requirements, technical dependencies, and testable acceptance criteria are 100% complete. Assigned developer can begin implementation immediately.
3. **IN PROGRESS:** Developer has actively started working on the code, test cases, or documentation in a feature branch.
4. **BLOCKED:** Task cannot proceed due to an external technical dependency, architectural blocker, or missing API specification.
5. **FOR QA:** Development is complete, self-tested, pull request created, and deployed to staging environment for QA Reviewer inspection.
6. **QA FAILED:** QA Reviewer identified regression, failed acceptance criteria, or security flaw during re-testing. Returned to developer with reproduction steps.
7. **QA PASSED:** QA Reviewer has verified all acceptance criteria on staging and confirmed zero regressions.
8. **DONE:** Project Manager has reviewed the QA report, accepted delivery, and approved merge/release.

---

## 2. Transition Gate Policies

- **Strict QA Gate:** Developers are strictly forbidden from marking any task as `QA PASSED` or `DONE`. Only QA Reviewer Jaymartimpas0-prog can designate `QA PASSED`, and only Project Manager jhnyz can close a task as `DONE`.
- **Pre-requisite Gate:** Tasks cannot transition from `BACKLOG` to `READY` unless all dependencies identified in `task-dependencies.md` have been fulfilled.
- **Git Commit Gate:** All commits must follow clean, single-task formatting. Source code modifications must never be merged without corresponding QA verification.
