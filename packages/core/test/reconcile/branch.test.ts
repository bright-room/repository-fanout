import { expect, test } from "vitest";
import { decideBranchAction } from "../../src/reconcile/branch.js";

test("diff + open PR -> update branch", () => {
  expect(decideBranchAction({ hasDiff: true, branchExists: true, pr: "open" }))
    .toEqual({ action: "update-branch" });
});

test("no diff + open PR -> noop", () => {
  expect(decideBranchAction({ hasDiff: false, branchExists: true, pr: "open" }))
    .toEqual({ action: "noop" });
});

test("diff + closed PR -> update branch and reopen", () => {
  expect(decideBranchAction({ hasDiff: true, branchExists: true, pr: "closed" }))
    .toEqual({ action: "update-branch", reopen: true });
});

test("diff + merged PR + branch exists -> recreate branch and new PR", () => {
  expect(decideBranchAction({ hasDiff: true, branchExists: true, pr: "merged" }))
    .toEqual({ action: "recreate-branch-new-pr" });
});

test("no diff + merged PR + stale branch -> delete branch", () => {
  expect(decideBranchAction({ hasDiff: false, branchExists: true, pr: "merged" }))
    .toEqual({ action: "delete-branch" });
});

test("diff + no PR + no branch -> create branch and PR", () => {
  expect(decideBranchAction({ hasDiff: true, branchExists: false, pr: "none" }))
    .toEqual({ action: "create-branch-and-pr" });
});

test("diff + no PR + stale branch exists -> update branch then create PR", () => {
  expect(decideBranchAction({ hasDiff: true, branchExists: true, pr: "none" }))
    .toEqual({ action: "update-branch-and-create-pr" });
});

test("no diff + nothing -> noop", () => {
  expect(decideBranchAction({ hasDiff: false, branchExists: false, pr: "none" }))
    .toEqual({ action: "noop" });
});
