package github

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"

	rserrors "github.com/tamara1031/temporal-repo-steward/internal/errors"
	"go.temporal.io/sdk/activity"
)

// Activities holds GitHub CLI operation implementations.
type Activities struct{}

// statusCheck is a single entry in the GitHub API status-check rollup.
type statusCheck struct {
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
	Name       string `json:"name"`
	DetailsURL string `json:"detailsUrl"`
}

// ciChecks summarises a status-check rollup slice at a single point in time.
type ciChecks struct {
	// empty is true when the rollup contained no checks at all; CI may not have
	// queued its runs yet.  Callers should wait and re-poll rather than treat
	// this as a definitive success.
	empty bool
	// allDone is true when every check has reached a terminal status.
	allDone bool
	// anyFailed is true when at least one completed check had a failure conclusion.
	anyFailed  bool
	failedURLs []string
}

// evaluateChecks distils a status-check rollup slice into a ciChecks summary.
// A check is considered failed when its Conclusion is "FAILURE" or "TIMED_OUT".
func evaluateChecks(checks []statusCheck) ciChecks {
	if len(checks) == 0 {
		return ciChecks{empty: true}
	}
	result := ciChecks{allDone: true}
	for _, c := range checks {
		if c.Status != "COMPLETED" {
			result.allDone = false
		} else if c.Conclusion == "FAILURE" || c.Conclusion == "TIMED_OUT" {
			result.anyFailed = true
			result.failedURLs = append(result.failedURLs, c.DetailsURL)
		}
	}
	return result
}

// CreatePRInput is the input to CreatePRActivity.
type CreatePRInput struct {
	WorkDir    string
	Title      string
	Body       string
	BaseBranch string
	Branch     string
}

// CreatePRResult is the output of CreatePRActivity.
type CreatePRResult struct {
	Number int
	URL    string
}

// CreatePRActivity creates a pull request via gh CLI.
func (a *Activities) CreatePRActivity(ctx context.Context, in CreatePRInput) (CreatePRResult, error) {
	out, err := ghOutput(ctx, in.WorkDir,
		"pr", "create",
		"--title", in.Title,
		"--body", in.Body,
		"--base", in.BaseBranch,
		"--head", in.Branch,
	)
	if err != nil {
		return CreatePRResult{}, fmt.Errorf("gh pr create: %w", err)
	}

	prURL := strings.TrimSpace(out)
	viewOut, err := ghOutput(ctx, in.WorkDir, "pr", "view", prURL, "--json", "number,url")
	if err != nil {
		return CreatePRResult{}, fmt.Errorf("gh pr view: %w", err)
	}
	var pr struct {
		Number int    `json:"number"`
		URL    string `json:"url"`
	}
	if err := json.Unmarshal([]byte(viewOut), &pr); err != nil {
		return CreatePRResult{}, rserrors.NewNonRetryable(rserrors.CodeInvalidGitHubOut, viewOut)
	}
	return CreatePRResult{Number: pr.Number, URL: pr.URL}, nil
}

// WaitForCIInput is the input to WaitForCIActivity.
type WaitForCIInput struct {
	WorkDir    string
	PRNumber   int
	MaxWaitSec int
}

// CIOutcome describes what happened to the PR's CI.
type CIOutcome string

const (
	CIOutcomeSuccess          CIOutcome = "success"
	CIOutcomeFailure          CIOutcome = "failure"
	CIOutcomeExternallyMerged CIOutcome = "externally_merged"
	CIOutcomeExternallyClosed CIOutcome = "externally_closed"
	CIOutcomeMergeQueued      CIOutcome = "merge-queued"
)

// WaitForCIResult is the output of WaitForCIActivity.
type WaitForCIResult struct {
	Outcome    CIOutcome
	FailedRuns []string
}

// minEmptyPollsBeforeSuccess is the number of consecutive empty status-check
// responses that must be observed before WaitForCIActivity declares success.
// GitHub Actions needs a moment to queue its check runs after a push; treating
// the very first empty rollup as "no CI configured" would cause the workflow to
// auto-merge before CI has had a chance to start.
const minEmptyPollsBeforeSuccess = 2

// WaitForCIActivity polls the PR's CI status until it settles.
func (a *Activities) WaitForCIActivity(ctx context.Context, in WaitForCIInput) (WaitForCIResult, error) {
	maxWait := time.Duration(in.MaxWaitSec) * time.Second
	if maxWait == 0 {
		maxWait = 3600 * time.Second
	}
	deadline := time.Now().Add(maxWait)
	pollInterval := 30 * time.Second

	emptyPollCount := 0

	for {
		if time.Now().After(deadline) {
			return WaitForCIResult{}, rserrors.NewCITimeout()
		}
		activity.RecordHeartbeat(ctx, fmt.Sprintf("polling CI for PR #%d", in.PRNumber))

		out, err := ghOutput(ctx, in.WorkDir, "pr", "view", fmt.Sprintf("%d", in.PRNumber),
			"--json", "state,statusCheckRollup")
		if err != nil {
			slog.Warn("gh pr view failed, retrying", "error", err)
			sleep(ctx, pollInterval)
			continue
		}

		var pr struct {
			State             string        `json:"state"`
			StatusCheckRollup []statusCheck `json:"statusCheckRollup"`
		}
		if err := json.Unmarshal([]byte(out), &pr); err != nil {
			slog.Warn("parse pr view output failed", "error", err)
			sleep(ctx, pollInterval)
			continue
		}

		switch strings.ToUpper(pr.State) {
		case "MERGED":
			return WaitForCIResult{Outcome: CIOutcomeExternallyMerged}, nil
		case "CLOSED":
			return WaitForCIResult{Outcome: CIOutcomeExternallyClosed}, nil
		}

		checks := evaluateChecks(pr.StatusCheckRollup)

		if checks.empty {
			emptyPollCount++
			if emptyPollCount < minEmptyPollsBeforeSuccess {
				slog.Info("CI checks not yet visible, waiting for next poll",
					"pr", in.PRNumber, "emptyPollCount", emptyPollCount)
				sleep(ctx, pollInterval)
				continue
			}
			slog.Info("no CI checks after grace period, treating as no-CI success",
				"pr", in.PRNumber)
			return WaitForCIResult{Outcome: CIOutcomeSuccess}, nil
		}
		emptyPollCount = 0

		if !checks.allDone {
			sleep(ctx, pollInterval)
			continue
		}
		if checks.anyFailed {
			return WaitForCIResult{Outcome: CIOutcomeFailure, FailedRuns: checks.failedURLs}, nil
		}
		return WaitForCIResult{Outcome: CIOutcomeSuccess}, nil
	}
}

// FetchFailedRunLogsInput is the input to FetchFailedRunLogsActivity.
type FetchFailedRunLogsInput struct {
	WorkDir       string
	PRNumber      int
	FailedRunURLs []string // preferred: targeted run detail-URLs from WaitForCIResult.FailedRuns
}

// FetchFailedRunLogsActivity fetches log output for failed CI runs.
// When FailedRunURLs is populated it fetches only those specific runs (targeted);
// otherwise it falls back to scanning the most recent 5 runs for failures.
func (a *Activities) FetchFailedRunLogsActivity(ctx context.Context, in FetchFailedRunLogsInput) (string, error) {
	var logs strings.Builder

	if len(in.FailedRunURLs) > 0 {
		for _, u := range in.FailedRunURLs {
			runID := runIDFromURL(u)
			if runID == "" {
				continue
			}
			activity.RecordHeartbeat(ctx, fmt.Sprintf("fetching logs for run %s", runID))
			runLog, err := ghOutput(ctx, in.WorkDir, "run", "view", runID, "--log-failed")
			if err != nil {
				slog.Warn("failed to fetch run logs", "runID", runID, "error", err)
				continue
			}
			logs.WriteString(fmt.Sprintf("=== Run %s ===\n%s\n", runID, runLog))
		}
		return logs.String(), nil
	}

	// Fallback: list the most recent runs and pick the failed ones.
	out, err := ghOutput(ctx, in.WorkDir, "run", "list",
		"--json", "databaseId,conclusion,status",
		"--limit", "5",
	)
	if err != nil {
		return "", err
	}

	var runs []struct {
		ID         int    `json:"databaseId"`
		Status     string `json:"status"`
		Conclusion string `json:"conclusion"`
	}
	if err := json.Unmarshal([]byte(out), &runs); err != nil {
		return "", err
	}

	for _, r := range runs {
		if r.Status == "completed" && (r.Conclusion == "failure" || r.Conclusion == "timed_out") {
			activity.RecordHeartbeat(ctx, fmt.Sprintf("fetching logs for run %d", r.ID))
			runLog, err := ghOutput(ctx, in.WorkDir, "run", "view",
				fmt.Sprintf("%d", r.ID), "--log-failed")
			if err != nil {
				slog.Warn("failed to fetch run logs", "runID", r.ID, "error", err)
				continue
			}
			logs.WriteString(fmt.Sprintf("=== Run %d ===\n%s\n", r.ID, runLog))
		}
	}
	return logs.String(), nil
}

// runIDFromURL extracts the numeric run ID from a GitHub Actions detail URL.
// Handles forms like: https://github.com/owner/repo/actions/runs/1234567890[/jobs/...]
func runIDFromURL(u string) string {
	const marker = "/runs/"
	idx := strings.LastIndex(u, marker)
	if idx < 0 {
		return ""
	}
	rest := u[idx+len(marker):]
	// Trim any trailing path segments (e.g. "/jobs/456")
	if slash := strings.Index(rest, "/"); slash >= 0 {
		rest = rest[:slash]
	}
	return rest
}

// MergePRInput is the input to MergePRActivity.
type MergePRInput struct {
	WorkDir  string
	PRNumber int
}

// MergePRActivity auto-squash-merges the PR via gh CLI.
func (a *Activities) MergePRActivity(ctx context.Context, in MergePRInput) error {
	return ghRun(ctx, in.WorkDir,
		"pr", "merge",
		fmt.Sprintf("%d", in.PRNumber),
		"--auto", "--squash", "--delete-branch",
	)
}

// ObservePRStateInput is the input to ObservePRStateActivity.
type ObservePRStateInput struct {
	WorkDir  string
	PRNumber int
	Attempts int
	Interval time.Duration
}

// ObservePRStateActivity polls the PR state until it is merged or closed.
func (a *Activities) ObservePRStateActivity(ctx context.Context, in ObservePRStateInput) (CIOutcome, error) {
	attempts := in.Attempts
	if attempts == 0 {
		attempts = 6
	}
	interval := in.Interval
	if interval == 0 {
		interval = 10 * time.Second
	}

	for i := 0; i < attempts; i++ {
		activity.RecordHeartbeat(ctx, fmt.Sprintf("observing PR #%d state (%d/%d)", in.PRNumber, i+1, attempts))

		out, err := ghOutput(ctx, in.WorkDir, "pr", "view",
			fmt.Sprintf("%d", in.PRNumber),
			"--json", "state,mergedAt")
		if err != nil {
			sleep(ctx, interval)
			continue
		}

		var pr struct {
			State    string `json:"state"`
			MergedAt string `json:"mergedAt"`
		}
		if err := json.Unmarshal([]byte(out), &pr); err != nil {
			sleep(ctx, interval)
			continue
		}

		switch strings.ToUpper(pr.State) {
		case "MERGED":
			return CIOutcomeSuccess, nil
		case "CLOSED":
			return CIOutcomeExternallyClosed, nil
		}
		sleep(ctx, interval)
	}
	return CIOutcomeMergeQueued, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func ghOutput(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "gh", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("gh %v: %w\nstderr: %s", args, err, exitErr.Stderr)
		}
		return "", fmt.Errorf("gh %v: %w", args, err)
	}
	return string(out), nil
}

func ghRun(ctx context.Context, dir string, args ...string) error {
	_, err := ghOutput(ctx, dir, args...)
	return err
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-time.After(d):
	case <-ctx.Done():
	}
}
