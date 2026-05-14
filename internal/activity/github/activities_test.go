package github

import "testing"

// ── evaluateChecks ────────────────────────────────────────────────────────────

func TestEvaluateChecks_NilSlice(t *testing.T) {
	r := evaluateChecks(nil)
	if !r.empty {
		t.Error("nil rollup: expected empty=true")
	}
	if r.allDone || r.anyFailed {
		t.Error("nil rollup: expected allDone=false and anyFailed=false")
	}
}

func TestEvaluateChecks_EmptySlice(t *testing.T) {
	r := evaluateChecks([]statusCheck{})
	if !r.empty {
		t.Error("empty slice: expected empty=true")
	}
}

func TestEvaluateChecks_AllPassed(t *testing.T) {
	checks := []statusCheck{
		{Status: "COMPLETED", Conclusion: "SUCCESS"},
		{Status: "COMPLETED", Conclusion: "NEUTRAL"},
		{Status: "COMPLETED", Conclusion: "SKIPPED"},
	}
	r := evaluateChecks(checks)
	if r.empty {
		t.Error("expected empty=false")
	}
	if !r.allDone {
		t.Error("expected allDone=true when all checks are COMPLETED")
	}
	if r.anyFailed {
		t.Error("expected anyFailed=false for SUCCESS/NEUTRAL/SKIPPED conclusions")
	}
}

func TestEvaluateChecks_OneFailed(t *testing.T) {
	checks := []statusCheck{
		{Status: "COMPLETED", Conclusion: "SUCCESS"},
		{Status: "COMPLETED", Conclusion: "FAILURE", DetailsURL: "https://example.com/runs/1"},
	}
	r := evaluateChecks(checks)
	if !r.allDone {
		t.Error("expected allDone=true when all checks are COMPLETED")
	}
	if !r.anyFailed {
		t.Error("expected anyFailed=true when one check has FAILURE conclusion")
	}
	if len(r.failedURLs) != 1 || r.failedURLs[0] != "https://example.com/runs/1" {
		t.Errorf("unexpected failedURLs: %v", r.failedURLs)
	}
}

func TestEvaluateChecks_TimedOut(t *testing.T) {
	checks := []statusCheck{
		{Status: "COMPLETED", Conclusion: "TIMED_OUT", DetailsURL: "https://example.com/runs/2"},
	}
	r := evaluateChecks(checks)
	if !r.allDone {
		t.Error("expected allDone=true")
	}
	if !r.anyFailed {
		t.Error("expected anyFailed=true when conclusion is TIMED_OUT")
	}
	if len(r.failedURLs) != 1 || r.failedURLs[0] != "https://example.com/runs/2" {
		t.Errorf("unexpected failedURLs: %v", r.failedURLs)
	}
}

func TestEvaluateChecks_StillPending(t *testing.T) {
	checks := []statusCheck{
		{Status: "COMPLETED", Conclusion: "SUCCESS"},
		{Status: "IN_PROGRESS"},
	}
	r := evaluateChecks(checks)
	if r.empty {
		t.Error("expected empty=false — rollup is non-empty")
	}
	if r.allDone {
		t.Error("expected allDone=false when an IN_PROGRESS check is present")
	}
	if r.anyFailed {
		t.Error("expected anyFailed=false")
	}
}

func TestEvaluateChecks_MultipleFailures(t *testing.T) {
	checks := []statusCheck{
		{Status: "COMPLETED", Conclusion: "FAILURE", DetailsURL: "https://example.com/runs/10"},
		{Status: "COMPLETED", Conclusion: "TIMED_OUT", DetailsURL: "https://example.com/runs/11"},
		{Status: "COMPLETED", Conclusion: "SUCCESS"},
	}
	r := evaluateChecks(checks)
	if !r.allDone {
		t.Error("expected allDone=true")
	}
	if !r.anyFailed {
		t.Error("expected anyFailed=true")
	}
	if len(r.failedURLs) != 2 {
		t.Errorf("expected 2 failedURLs, got %d: %v", len(r.failedURLs), r.failedURLs)
	}
}

// ── runIDFromURL ─────────────────────────────────────────────────────────────

func TestRunIDFromURL(t *testing.T) {
	cases := []struct {
		url  string
		want string
	}{
		{
			url:  "https://github.com/owner/repo/actions/runs/1234567890",
			want: "1234567890",
		},
		{
			url:  "https://github.com/owner/repo/actions/runs/9876543210/jobs/111",
			want: "9876543210",
		},
		{
			url:  "https://github.com/owner/repo/actions/runs/42/",
			want: "42",
		},
		{
			url:  "https://example.com/no-runs-marker",
			want: "",
		},
		{
			url:  "",
			want: "",
		},
	}

	for _, c := range cases {
		got := runIDFromURL(c.url)
		if got != c.want {
			t.Errorf("runIDFromURL(%q) = %q; want %q", c.url, got, c.want)
		}
	}
}
