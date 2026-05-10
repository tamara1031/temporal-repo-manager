package workflow_test

import (
	"testing"

	codexact "github.com/tamara1031/temporal-repo-steward/internal/activity/codex"
	gitact "github.com/tamara1031/temporal-repo-steward/internal/activity/git"
	ghact "github.com/tamara1031/temporal-repo-steward/internal/activity/github"
	"github.com/tamara1031/temporal-repo-steward/internal/workflow"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"
	"go.temporal.io/sdk/testsuite"
)

type prLifecycleSuite struct {
	suite.Suite
	testsuite.WorkflowTestSuite
}

func TestPRLifecycleSuite(t *testing.T) {
	suite.Run(t, new(prLifecycleSuite))
}

func mergeInput(autoMerge bool) workflow.RobustPRMergeInput {
	return workflow.RobustPRMergeInput{
		RepoFullName: "owner/repo",
		WorkDir:      "/tmp/ws",
		Branch:       "codex-session/test",
		BaseBranch:   "main",
		PRTitle:      "chore: automated refactor",
		PRBody:       "body",
		SessionID:    "test-session-00000001",
		AutoMerge:    autoMerge,
	}
}

func (s *prLifecycleSuite) setupPushAndCreate(env *testsuite.TestWorkflowEnvironment) {
	var gitActs *gitact.Activities
	var ghActs *ghact.Activities
	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)
	env.OnActivity(ghActs.CreatePRActivity, mock.Anything, mock.Anything).
		Return(ghact.CreatePRResult{Number: 42, URL: "https://github.com/owner/repo/pull/42"}, nil)
}

func (s *prLifecycleSuite) Test_AutoMergeDisabled_WhenCIPasses() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.Equal(42, result.PRNumber)
	s.Equal("auto-merge-disabled", result.Outcome)
	s.False(result.Merged)
}

func (s *prLifecycleSuite) Test_ExternallyMerged() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeExternallyMerged}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.Equal("merged-externally", result.Outcome)
	s.True(result.Merged)
}

func (s *prLifecycleSuite) Test_ExternallyClosed() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeExternallyClosed}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.Equal("closed-externally", result.Outcome)
	s.False(result.Merged)
}

func (s *prLifecycleSuite) Test_AutoMerge_CIPassesThenMerges() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil)

	env.OnActivity(ghActs.MergePRActivity, mock.Anything, mock.Anything).Return(nil)

	env.OnActivity(ghActs.ObservePRStateActivity, mock.Anything, mock.Anything).
		Return(ghact.CIOutcomeSuccess, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(true))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.True(result.Merged)
	s.Equal(42, result.PRNumber)
}

// Test_SelfHeal_OneCIFailureThenSuccess verifies the self-heal loop:
// CI fails once → codex fixes it → push → CI passes → auto-merge-disabled.
func (s *prLifecycleSuite) Test_SelfHeal_OneCIFailureThenSuccess() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	var gitActs *gitact.Activities
	var codexActs *codexact.Activities
	s.setupPushAndCreate(env)

	// First CI poll: failure.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{
			Outcome:    ghact.CIOutcomeFailure,
			FailedRuns: []string{"https://github.com/owner/repo/actions/runs/1"},
		}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("error: undefined: Foo\n", nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "fixed"}, nil)

	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("fixsha", nil)

	// Force-push after fix.
	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)

	// Second CI poll: success.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil).Once()

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.Equal("auto-merge-disabled", result.Outcome)
	s.Equal(42, result.PRNumber)
}

// Test_QueryCIProgress_PRCreated verifies that after a clean CI pass, the
// ci_progress query exposes the PR number, URL, and last CI outcome.
func (s *prLifecycleSuite) Test_QueryCIProgress_PRCreated() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())

	encoded, err := env.QueryWorkflow(workflow.QueryCIProgress)
	s.NoError(err)
	var progress workflow.CIProgress
	s.NoError(encoded.Get(&progress))

	s.Equal(42, progress.PRNumber)
	s.Equal("https://github.com/owner/repo/pull/42", progress.PRURL)
	s.Equal(string(ghact.CIOutcomeSuccess), progress.LastOutcome)
	s.Equal(maxFixIterations, progress.MaxIterations)
}

// Test_QueryCIProgress_SelfHealIteration verifies that after one CI failure and
// a successful fix, the ci_progress query reflects the correct iteration count
// and the final CI outcome.
func (s *prLifecycleSuite) Test_QueryCIProgress_SelfHealIteration() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	var gitActs *gitact.Activities
	var codexActs *codexact.Activities
	s.setupPushAndCreate(env)

	// First CI: failure.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeFailure}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("error: undefined: Foo\n", nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "fixed"}, nil)

	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("fixsha", nil)

	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)

	// Second CI: success.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil).Once()

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())

	encoded, err := env.QueryWorkflow(workflow.QueryCIProgress)
	s.NoError(err)
	var progress workflow.CIProgress
	s.NoError(encoded.Get(&progress))

	s.Equal(42, progress.PRNumber)
	// Iteration 1 (0-indexed) is where success was observed.
	s.Equal(1, progress.Iteration)
	s.Equal(string(ghact.CIOutcomeSuccess), progress.LastOutcome)
}

// Test_AdvisorAborts_OnSecondCIFailure verifies that when CI fails twice and the
// advisor returns "abort" on the 2nd iteration, the workflow terminates with an
// AdvisorAbort non-retryable error.
func (s *prLifecycleSuite) Test_AdvisorAborts_OnSecondCIFailure() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	var gitActs *gitact.Activities
	var codexActs *codexact.Activities
	s.setupPushAndCreate(env)

	// Iteration 0: CI failure — no advisor, fix normally.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{
			Outcome:    ghact.CIOutcomeFailure,
			FailedRuns: []string{"https://github.com/owner/repo/actions/runs/1"},
		}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("error: build failed\n", nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "fixed"}, nil)

	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("fixsha", nil)

	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)

	// Iteration 1: CI still failing — advisor consulted.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{
			Outcome:    ghact.CIOutcomeFailure,
			FailedRuns: []string{"https://github.com/owner/repo/actions/runs/2"},
		}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("error: still broken\n", nil)

	env.OnActivity(codexActs.ConsultAdvisorActivity, mock.Anything, mock.Anything).
		Return(codexact.AdvisorVerdict{
			Verdict:   codexact.AdvisorDecisionAbort,
			Rationale: "root cause is structural, cannot auto-fix",
		}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	// Advisor abort produces a non-retryable error.
	s.Error(env.GetWorkflowError())
}

// Test_AdvisorRetry_OnSecondCIFailure verifies that when the advisor returns
// "retry" on the 2nd iteration, the self-heal loop continues normally.
func (s *prLifecycleSuite) Test_AdvisorRetry_OnSecondCIFailure() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	var gitActs *gitact.Activities
	var codexActs *codexact.Activities
	s.setupPushAndCreate(env)

	// Iteration 0: CI failure — fix and push.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeFailure}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("err\n", nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "fix"}, nil)

	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("sha1", nil)

	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)

	// Iteration 1: CI failure — advisor says retry, fix and push again.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeFailure}, nil).Once()

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("err\n", nil)

	env.OnActivity(codexActs.ConsultAdvisorActivity, mock.Anything, mock.Anything).
		Return(codexact.AdvisorVerdict{
			Verdict:   codexact.AdvisorDecisionRetry,
			Rationale: "worth another shot",
		}, nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "fix2"}, nil)

	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("sha2", nil)

	env.OnActivity(gitActs.PushBranchActivity, mock.Anything, mock.Anything).Return(nil)

	// Iteration 2: CI succeeds.
	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeSuccess}, nil).Once()

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.NoError(env.GetWorkflowError())
	var result workflow.RobustPRMergeResult
	s.NoError(env.GetWorkflowResult(&result))
	s.Equal("auto-merge-disabled", result.Outcome)
}

// Test_AdvisorAborts_OnNoDiff verifies that when codex produces no diff and the
// advisor returns "abort", the workflow terminates with an AdvisorAbort error.
func (s *prLifecycleSuite) Test_AdvisorAborts_OnNoDiff() {
	env := s.NewTestWorkflowEnvironment()
	var ghActs *ghact.Activities
	var gitActs *gitact.Activities
	var codexActs *codexact.Activities
	s.setupPushAndCreate(env)

	env.OnActivity(ghActs.WaitForCIActivity, mock.Anything, mock.Anything).
		Return(ghact.WaitForCIResult{Outcome: ghact.CIOutcomeFailure}, nil)

	env.OnActivity(ghActs.FetchFailedRunLogsActivity, mock.Anything, mock.Anything).
		Return("error: type mismatch\n", nil)

	env.OnActivity(codexActs.ChatActivity, mock.Anything, mock.Anything).
		Return(codexact.ChatResult{SessionID: "test-session-00000001", Response: "no idea"}, nil)

	// Commit fails: no diff produced.
	env.OnActivity(gitActs.CommitAllActivity, mock.Anything, mock.Anything).
		Return("", testErr("no changes to commit"))

	// Advisor consulted on no-diff.
	env.OnActivity(codexActs.ConsultAdvisorActivity, mock.Anything, mock.Anything).
		Return(codexact.AdvisorVerdict{
			Verdict:   codexact.AdvisorDecisionAbort,
			Rationale: "unfixable type error in generated code",
		}, nil)

	env.ExecuteWorkflow(workflow.RobustPRMergeWorkflow, mergeInput(false))

	s.True(env.IsWorkflowCompleted())
	s.Error(env.GetWorkflowError())
}

// maxFixIterations is re-exported via the test package for assertion purposes.
// Keep in sync with the unexported constant in pr_lifecycle.go.
const maxFixIterations = 8
